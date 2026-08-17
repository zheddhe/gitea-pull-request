import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import type { RepoInfo } from "../context/repoManager";
import type {
  GiteaPullRequest,
  GiteaComment,
  GiteaReview,
  GiteaFileDiff,
  GiteaCommit,
  GiteaReviewComment,
} from "../api/types";
import { log } from "../debug/outputChannel";

function parseRawDiff(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of raw.split(/^diff --git /m).slice(1)) {
    const firstLine = block.split("\n")[0];
    const match = firstLine.match(/ b\/(.+)$/);
    if (!match) continue;
    const hunkIndex = block.indexOf("\n@@");
    map.set(match[1].trim(), hunkIndex >= 0 ? block.slice(hunkIndex + 1) : "");
  }
  return map;
}

interface DiffLine {
  type: "hunk" | "add" | "del" | "ctx" | "meta";
  content: string;
  oldLine?: number;
  newLine?: number;
  pos: number;
}

function parsePatch(patch: string): DiffLine[] {
  if (!patch?.trim()) return [];
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let pos = 0;
  for (const raw of patch.split("\n")) {
    pos += 1;
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10) - 1;
        newLine = parseInt(match[2], 10) - 1;
      }
      result.push({ type: "hunk", content: raw, pos });
    } else if (raw.startsWith("+")) {
      newLine += 1;
      result.push({ type: "add", content: raw.slice(1), newLine, pos });
    } else if (raw.startsWith("-")) {
      oldLine += 1;
      result.push({ type: "del", content: raw.slice(1), oldLine, pos });
    } else if (raw.startsWith("\\")) {
      result.push({ type: "meta", content: raw, pos });
    } else if (raw !== "") {
      oldLine += 1;
      newLine += 1;
      result.push({ type: "ctx", content: raw.slice(1), oldLine, newLine, pos });
    }
  }
  return result;
}

export class PRDetailPanel {
  private static panels = new Map<number, PRDetailPanel>();
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static async show(
    extensionUri: vscode.Uri,
    api: GiteaApiClient,
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
  ): Promise<void> {
    const existing = PRDetailPanel.panels.get(pr.number);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "giteaPRDetail",
      `PR #${pr.number}: ${pr.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new PRDetailPanel(panel, extensionUri, api, repoInfo, pr);
    PRDetailPanel.panels.set(pr.number, instance);
    await instance.update(pr);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly api: GiteaApiClient,
    private readonly repoInfo: RepoInfo,
    private pr: GiteaPullRequest,
  ) {
    this.panel = panel;
    void this.extensionUri;
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  private async handleMessage(message: {
    command: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (message.command) {
      case "submitReview":
        await this.submitReviewWithComments(
          message.event as "APPROVED" | "REQUEST_CHANGES" | "COMMENT",
          (message.body as string) ?? "",
          (message.comments as Array<{
            path: string;
            new_position: number;
            old_position: number;
            body: string;
          }>) ?? [],
        );
        break;
      case "addComment":
        await this.addPRComment((message.body as string) ?? "");
        break;
      case "merge":
        await this.merge(
          (message.method as "merge" | "rebase" | "squash") ?? "merge",
        );
        break;
      case "closePR":
        await this.setPRState("closed");
        break;
      case "reopenPR":
        await this.setPRState("open");
        break;
      case "editTitle":
        await this.updatePullRequest(
          { title: ((message.title as string) ?? "").trim() },
          "title updated",
        );
        break;
      case "editBody":
        await this.updatePullRequest(
          { body: (message.body as string) ?? "" },
          "description updated",
        );
        break;
      case "updateBase":
        await this.updatePullRequest(
          { base: (message.base as string) ?? this.pr.base.ref },
          "target branch updated",
        );
        break;
      case "refresh":
        this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
        await this.update(this.pr);
        break;
      case "openInBrowser":
        await vscode.env.openExternal(vscode.Uri.parse(this.pr.html_url));
        break;
      case "openExternal":
        await this.openExternal((message.url as string) ?? "");
        break;
      case "checkout":
        await vscode.commands.executeCommand(
          "gitea.checkoutPR",
          this.pr,
          this.repoInfo,
        );
        break;
      default:
        log(`PR unknown message: ${message.command}`);
    }
  }

  private async openExternal(rawUrl: string): Promise<void> {
    try {
      const resolved = new URL(rawUrl, this.pr.html_url);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        throw new Error("Unsupported URL scheme");
      }
      await vscode.env.openExternal(vscode.Uri.parse(resolved.toString()));
    } catch (error) {
      log(`PR link rejected: ${rawUrl} (${(error as Error).message})`);
      vscode.window.showWarningMessage("Unsupported pull request link.");
    }
  }

  private async updatePullRequest(
    params: { title?: string; body?: string; base?: string },
    successLabel: string,
  ): Promise<void> {
    if (params.title !== undefined && !params.title.trim()) {
      vscode.window.showWarningMessage("Title cannot be empty.");
      return;
    }
    if (params.base !== undefined && !params.base.trim()) {
      vscode.window.showWarningMessage("Target branch cannot be empty.");
      return;
    }
    try {
      this.pr = await this.api.updatePullRequest(
        this.repoInfo,
        this.pr.number,
        params,
      );
      this.panel.title = `PR #${this.pr.number}: ${this.pr.title}`;
      await this.update(this.pr);
      vscode.window.showInformationMessage(
        `PR #${this.pr.number} ${successLabel}.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed: ${(error as Error).message}`);
    }
  }

  private async setPRState(state: "open" | "closed"): Promise<void> {
    try {
      if (state === "closed") {
        const confirmation = await vscode.window.showWarningMessage(
          `Close PR #${this.pr.number}?`,
          { modal: true },
          "Confirm",
        );
        if (confirmation !== "Confirm") return;
        this.pr = await this.api.closePullRequest(this.repoInfo, this.pr.number);
      } else {
        this.pr = await this.api.reopenPullRequest(this.repoInfo, this.pr.number);
      }
      this.panel.title = `PR #${this.pr.number}: ${this.pr.title}`;
      await this.update(this.pr);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed: ${(error as Error).message}`);
    }
  }

  private async submitReviewWithComments(
    event: "APPROVED" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: Array<{
      path: string;
      new_position: number;
      old_position: number;
      body: string;
    }>,
  ): Promise<void> {
    try {
      await this.api.createReview(
        this.repoInfo,
        this.pr.number,
        event,
        body,
        comments,
      );
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to submit review: ${(error as Error).message}`,
      );
    }
  }

  private async addPRComment(body: string): Promise<void> {
    if (!body.trim()) return;
    try {
      await this.api.addPRComment(this.repoInfo, this.pr.number, body);
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed: ${(error as Error).message}`);
    }
  }

  private async merge(method: "merge" | "rebase" | "squash"): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      `Merge PR #${this.pr.number} using "${method}"?`,
      { modal: true },
      "Confirm",
    );
    if (confirmation !== "Confirm") return;
    try {
      await this.api.mergePullRequest(this.repoInfo, this.pr.number, method);
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
      vscode.window.showInformationMessage(`PR #${this.pr.number} merged.`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to merge: ${(error as Error).message}`,
      );
    }
  }

  async update(pr: GiteaPullRequest): Promise<void> {
    log(`PR update: #${pr.number}`);
    try {
      const [comments, reviews, files, commits, reviewComments, rawDiff, branches] =
        await Promise.all([
          this.api.listPRComments(this.repoInfo, pr.number),
          this.api.listReviews(this.repoInfo, pr.number),
          this.api.listPRFiles(this.repoInfo, pr.number),
          this.api.listPRCommits(this.repoInfo, pr.number),
          this.api
            .listAllPRReviewComments(this.repoInfo, pr.number)
            .catch(() => [] as GiteaReviewComment[]),
          this.api.getPRRawDiff(this.repoInfo, pr.number).catch(() => ""),
          this.api.listBranches(this.repoInfo).catch(() => [] as string[]),
        ]);

      const patchMap = parseRawDiff(rawDiff);
      const enrichedFiles = files.map((file) => ({
        ...file,
        patch: patchMap.get(file.filename) ?? file.patch ?? "",
      }));
      const markdownSources = [
        pr.body ?? "",
        ...comments.map((comment) => comment.body ?? ""),
        ...reviews.map((review) => review.body ?? ""),
      ];
      const renderedMarkdown = await Promise.all(
        markdownSources.map((source) => this.renderMarkdown(source)),
      );
      const bodyHtml = renderedMarkdown[0] ?? "";
      const commentBodies = renderedMarkdown.slice(1, 1 + comments.length);
      const reviewBodies = renderedMarkdown.slice(1 + comments.length);

      this.panel.webview.html = this.renderHtml(
        pr,
        comments,
        reviews,
        enrichedFiles,
        commits,
        reviewComments,
        branches,
        bodyHtml,
        commentBodies,
        reviewBodies,
      );
    } catch (error) {
      this.panel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)"><h2>Error loading PR</h2><p>${escHtml((error as Error).message)}</p></body></html>`;
    }
  }

  private async renderMarkdown(markdown: string): Promise<string> {
    if (!markdown.trim()) return "";
    try {
      const rendered = await vscode.commands.executeCommand<string>(
        "markdown.api.render",
        markdown,
      );
      if (typeof rendered === "string") return rendered;
      throw new Error("VS Code Markdown renderer returned no HTML");
    } catch (error) {
      log(`PR Markdown renderer fallback: ${(error as Error).message}`);
      return `<pre>${escHtml(markdown)}</pre>`;
    }
  }

  private buildDiffRows(
    patch: string,
    fileIndex: number,
    filename: string,
    reviewComments: GiteaReviewComment[],
  ): string {
    const lines = parsePatch(patch);
    if (lines.length === 0) {
      return `<tr><td colspan="3" class="empty-diff">No diff available</td></tr>`;
    }
    const commentMap = new Map<string, GiteaReviewComment[]>();
    for (const comment of reviewComments.filter((item) => item.path === filename)) {
      const key = `${comment.new_position ?? 0}:${comment.old_position ?? 0}`;
      commentMap.set(key, [...(commentMap.get(key) ?? []), comment]);
    }

    let rows = "";
    for (const line of lines) {
      const rowClass =
        line.type === "add"
          ? "diff-add"
          : line.type === "del"
            ? "diff-del"
            : line.type === "hunk"
              ? "diff-hunk"
              : "diff-ctx";
      const clickable = ["add", "del", "ctx"].includes(line.type);
      const prefix =
        line.type === "add"
          ? "+"
          : line.type === "del"
            ? "-"
            : line.type === "hunk"
              ? ""
              : "\u00a0";
      const content =
        line.type === "hunk"
          ? escHtml(line.content)
          : escHtml(prefix) + escHtml(line.content);
      const key = `${fileIndex}-${line.pos}`;
      const data = `data-file-index="${fileIndex}" data-pos="${line.pos}" data-path="${escHtml(filename)}" data-new-line="${line.newLine ?? 0}" data-old-line="${line.oldLine ?? 0}"`;
      rows += `<tr class="${rowClass}${clickable ? " clickable-line" : ""}" ${clickable ? data : ""}><td class="ln">${line.oldLine ?? ""}</td><td class="ln">${line.newLine ?? ""}</td><td class="lc"><pre>${content}</pre></td></tr>`;
      if (clickable) {
        rows += `<tr class="comment-form-row" id="comment-form-${key}" data-path="${escHtml(filename)}" data-new-line="${line.newLine ?? 0}" data-old-line="${line.oldLine ?? 0}" hidden><td colspan="3"><div class="inline-comment-form"><textarea placeholder="Leave a review comment on this line..."></textarea><div class="inline-actions"><button class="btn add-inline">Add Review Comment</button><button class="btn sec cancel-inline">Cancel</button></div></div></td></tr>`;
      }
      const reviewKey = `${line.newLine ?? 0}:${line.oldLine ?? 0}`;
      for (const comment of commentMap.get(reviewKey) ?? []) {
        rows += `<tr class="existing-review-comment"><td colspan="3"><div class="review-comment-card"><div class="review-comment-header"><strong>${escHtml(comment.user.login)}</strong><span class="muted">${escHtml(new Date(comment.created_at).toLocaleString())}</span></div><div class="review-comment-body">${escHtml(comment.body)}</div></div></td></tr>`;
      }
    }
    return rows;
  }

  private renderHtml(
    pr: GiteaPullRequest,
    comments: GiteaComment[],
    reviews: GiteaReview[],
    files: (GiteaFileDiff & { patch: string })[],
    commits: GiteaCommit[],
    reviewComments: GiteaReviewComment[],
    branches: string[],
    bodyHtml: string,
    commentBodies: string[],
    reviewBodies: string[],
  ): string {
    const isOpen = pr.state === "open" && !pr.merged;
    const stateLabel = pr.merged ? "Merged" : isOpen ? "Open" : "Closed";
    const stateClass = pr.merged
      ? "state-merged"
      : isOpen
        ? "state-open"
        : "state-closed";
    const nonce = getNonce();
    const activeReviews = reviews
      .filter((review) => !review.stale)
      .sort(
        (left, right) =>
          new Date(left.submitted_at).getTime() -
          new Date(right.submitted_at).getTime(),
      );
    const latestReview =
      activeReviews.length > 0
        ? activeReviews[activeReviews.length - 1].state
        : undefined;
    const reviewStatus =
      latestReview === "APPROVED"
        ? "approved"
        : latestReview === "REQUEST_CHANGES"
          ? "changes-requested"
          : "pending";
    const reviewLabel =
      reviewStatus === "approved"
        ? "Approved"
        : reviewStatus === "changes-requested"
          ? "Changes Requested"
          : "Pending";

    const labelsHtml =
      pr.labels
        ?.map(
          (label) =>
            `<span class="label" style="--label-color:#${escHtml(label.color)}">${escHtml(label.name)}</span>`,
        )
        .join("") ?? "";
    const assignees = pr.assignees?.length
      ? pr.assignees.map((assignee) => assignee.login).join(", ")
      : pr.assignee?.login;
    const assigneesHtml = assignees
      ? `<span>assigned to <strong>${escHtml(assignees)}</strong></span>`
      : "";
    const milestoneHtml = pr.milestone
      ? `<span class="muted">Milestone: ${escHtml(pr.milestone.title)}</span>`
      : "";
    const branchOptions = branches
      .filter((branch) => branch !== pr.head.ref)
      .map(
        (branch) =>
          `<option value="${escHtml(branch)}"${branch === pr.base.ref ? " selected" : ""}>${escHtml(branch)}</option>`,
      )
      .join("");

    const commentsHtml = comments.length
      ? comments
          .map(
            (comment, index) =>
              `<article class="comment"><header class="comment-header"><img src="${escHtml(comment.user.avatar_url)}" class="avatar" alt=""><strong>${escHtml(comment.user.login)}</strong><span class="time">${escHtml(new Date(comment.created_at).toLocaleString())}</span></header><div class="comment-body markdown-body">${commentBodies[index] ?? ""}</div></article>`,
          )
          .join("")
      : '<p class="empty">No comments yet.</p>';

    const reviewsHtml = activeReviews.length
      ? activeReviews
          .map((review) => {
            const sourceIndex = reviews.indexOf(review);
            const state = review.state.toLowerCase();
            const label = review.state.replace(/_/g, " ");
            return `<article class="review review-${state}"><header class="review-header"><strong>${escHtml(review.user.login)}</strong><span class="review-badge review-badge-${state}">${escHtml(label)}</span><span class="time">${escHtml(new Date(review.submitted_at).toLocaleString())}</span></header>${review.body?.trim() ? `<div class="review-body markdown-body">${reviewBodies[sourceIndex] ?? ""}</div>` : ""}</article>`;
          })
          .join("")
      : '<p class="empty">No reviews yet.</p>';

    const commitsHtml = commits.length
      ? commits
          .map(
            (commit) =>
              `<article class="commit-entry"><code class="sha">${escHtml(commit.sha.slice(0, 8))}</code><span class="commit-message">${escHtml(commit.commit.message.split("\n")[0])}</span><span class="commit-author">${escHtml(commit.commit.author.name)}</span></article>`,
          )
          .join("")
      : '<p class="empty">No commits.</p>';

    const filesHtml = files
      .map((file, fileIndex) => {
        const diffRows = this.buildDiffRows(
          file.patch,
          fileIndex,
          file.filename,
          reviewComments,
        );
        return `<section class="file-block"><button class="file-header" data-file-toggle="${fileIndex}" aria-expanded="false"><span class="file-path">${escHtml(file.filename)}</span><span class="file-stats"><span class="additions">+${file.additions}</span> <span class="deletions">-${file.deletions}</span></span><span class="chevron">›</span></button><div class="file-diff" id="file-diff-${fileIndex}" hidden><table class="diff-table"><tbody>${diffRows}</tbody></table></div></section>`;
      })
      .join("");

    const discussionIcon = `<svg class="tab-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h12v9H7.2L4 13.7V11H2V2zm1 1v7h2v1.55L6.8 10H13V3H3z"/></svg>`;
    const editIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.3 1.7a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8.6 8.6-3.2.7.7-3.2 8.1-9.1zm.7 1.1-7.9 8.8-.3 1.1 1.1-.3 8.3-8.3L12 2.8z"/></svg>`;
    const refreshIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.2 3.8A6 6 0 1 0 14 9h-1.2a4.8 4.8 0 1 1-.7-4.3L10 6h5V1l-1.8 2.8z"/></svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR #${pr.number}</title>
<style>
:root{--surface:var(--vscode-editor-background);--subtle:var(--vscode-textBlockQuote-background,var(--vscode-editor-inactiveSelectionBackground));--fg:var(--vscode-foreground);--muted:var(--vscode-descriptionForeground);--border:var(--vscode-panel-border,var(--vscode-widget-border));--focus:var(--vscode-focusBorder);--input-bg:var(--vscode-input-background);--input-fg:var(--vscode-input-foreground);--input-border:var(--vscode-input-border,transparent);--button-bg:var(--vscode-button-background);--button-fg:var(--vscode-button-foreground);--button-hover:var(--vscode-button-hoverBackground);--button-secondary-bg:var(--vscode-button-secondaryBackground);--button-secondary-fg:var(--vscode-button-secondaryForeground);--success:var(--vscode-testing-iconPassed,var(--vscode-charts-green));--danger:var(--vscode-testing-iconFailed,var(--vscode-errorForeground));--warning:var(--vscode-editorWarning-foreground,var(--vscode-charts-yellow));--info:var(--vscode-textLink-foreground);--merged:var(--vscode-charts-purple);--mono:var(--vscode-editor-font-family)}
*{box-sizing:border-box}html,body{margin:0;background:var(--surface);color:var(--fg)}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);line-height:1.45;padding:16px 20px}button,input,textarea,select{font:inherit}
.title-row{display:flex;align-items:center;gap:7px;min-width:0;margin-bottom:5px;white-space:nowrap}.title-prefix{font-size:1.22em;font-weight:600;flex:0 0 auto}.title-text{font-size:1.22em;font-weight:600;overflow:hidden;text-overflow:ellipsis}.title-input{display:none;min-width:180px;width:min(520px,45vw);font-size:1.22em;font-weight:600;padding:1px 5px}.title-row.editing .title-text{display:none}.title-row.editing .title-input{display:inline-block}.state-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:currentColor}.state-open{color:var(--success)}.state-closed{color:var(--danger)}.state-merged{color:var(--merged)}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:2px;border:0;border-radius:3px;background:transparent;color:var(--muted);cursor:pointer;flex:0 0 auto}.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground,var(--subtle));color:var(--fg)}.icon-btn svg{width:14px;height:14px}.meta-row,.review-row,.branch-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;color:var(--muted);font-size:.92em}.meta-row{margin-bottom:5px}.review-row{margin-bottom:4px}.branch-row{margin-bottom:12px}.meta-row strong,.context-label{color:var(--fg);font-weight:600}.badge,.review-state{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.82em;font-weight:600}.badge{text-transform:uppercase}.review-approved{color:var(--success)}.review-changes-requested{color:var(--danger)}.review-pending{color:var(--warning)}.label{border:1px solid var(--label-color);border-radius:999px;padding:1px 7px;font-size:.78em}.branch-tag{font-family:var(--mono);background:var(--subtle);border:1px solid var(--border);border-radius:2px;padding:1px 6px;color:var(--fg)}.branch-select{font-family:var(--mono);min-height:24px;padding:1px 24px 1px 6px;background:var(--subtle);color:var(--fg);border:1px solid var(--border);border-radius:2px}
.actions,.editor-actions,.review-actions,.review-batch-actions{display:flex;gap:6px;flex-wrap:wrap}.actions{margin-bottom:14px}.btn{border:1px solid transparent;border-radius:2px;padding:4px 10px;min-height:26px;cursor:pointer;background:var(--button-bg);color:var(--button-fg)}.btn.sec{background:var(--button-secondary-bg);color:var(--button-secondary-fg)}.btn.success{background:var(--button-secondary-bg);color:var(--success);border-color:var(--success)}.btn.danger{background:var(--button-secondary-bg);color:var(--danger);border-color:var(--danger)}.btn:focus-visible,.icon-btn:focus-visible,.tab:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.file-header:focus-visible{outline:1px solid var(--focus);outline-offset:2px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:14px}.tab{display:inline-flex;align-items:center;gap:6px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--muted);cursor:pointer;padding:6px 10px}.tab.active{color:var(--fg);border-bottom-color:var(--focus);font-weight:600}.tab-icon{width:15px;height:15px}.tab-content{display:none}.tab-content.active{display:block}
.section-card,.review-submit,.comment,.review,.file-block{border:1px solid var(--border);border-radius:3px;margin-bottom:10px;overflow:hidden}.section-card{margin-bottom:14px}.section-bar,.comment-header,.review-header{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--subtle);border-bottom:1px solid var(--border)}.section-bar{justify-content:space-between;font-weight:600}.section-content,.comment-body,.review-body{padding:10px 12px}.description-editor,.review-submit,.inline-comment-form{padding:10px 12px;background:var(--subtle)}.description-editor textarea{min-height:140px}.editor-actions,.review-actions{margin-top:8px}.review-batch-actions{align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}.pending-label{color:var(--muted);font-size:.9em}.submit-inline{display:none}.submit-inline.visible{display:inline-flex}
textarea,input[type="text"],select{background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:2px;padding:6px 8px}textarea,input[type="text"]{width:100%}textarea{resize:vertical;line-height:1.45}.markdown-body{line-height:1.5;overflow-wrap:anywhere}.markdown-body h1,.markdown-body h2,.markdown-body h3{font-weight:600;line-height:1.3}.markdown-body h1{font-size:1.28em}.markdown-body h2{font-size:1.16em}.markdown-body h3{font-size:1.06em}.markdown-body code,.sha,.file-path,.diff-table{font-family:var(--mono)}.markdown-body pre{overflow:auto}.avatar{width:20px;height:20px;border-radius:50%}.time{margin-left:auto;color:var(--muted);font-size:.92em}.empty,.muted{color:var(--muted)}
.review{border-left-width:3px}.review-approved{border-left-color:var(--success)}.review-request_changes{border-left-color:var(--danger)}.review-comment,.review-commented{border-left-color:var(--info)}.review-badge{font-size:.78em;border:1px solid currentColor;border-radius:999px;padding:1px 6px}.review-badge-approved{color:var(--success)}.review-badge-request_changes{color:var(--danger)}.review-badge-comment,.review-badge-commented{color:var(--info)}.section-heading{font-size:1em;font-weight:600;margin:14px 0 8px}
.commit-entry{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border)}.commit-author{color:var(--muted)}.file-header{width:100%;display:flex;align-items:center;gap:8px;border:0;background:var(--subtle);padding:7px 10px;cursor:pointer;text-align:left}.file-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.additions{color:var(--success)}.deletions{color:var(--danger)}.chevron{color:var(--muted)}.file-diff{overflow:auto;border-top:1px solid var(--border)}.diff-table{width:100%;border-collapse:collapse;font-size:.9em;table-layout:fixed}.ln{width:44px;text-align:right;padding:0 6px;color:var(--muted);background:var(--subtle);border-right:1px solid var(--border)}.lc{padding:0 8px;white-space:pre}.lc pre{margin:0;font:inherit}.diff-add .lc{background:color-mix(in srgb,var(--success) 12%,transparent)}.diff-del .lc{background:color-mix(in srgb,var(--danger) 12%,transparent)}.diff-hunk td{background:color-mix(in srgb,var(--info) 10%,transparent);color:var(--info)}.clickable-line{cursor:pointer}.inline-actions{display:flex;gap:6px;margin-top:6px}.review-comment-card,.pending-review-comment{padding:8px 12px;background:var(--subtle)}.review-comment-card{border-left:3px solid var(--info)}.pending-review-comment{border-left:3px dashed var(--warning);display:flex;gap:8px}.pending-body{flex:1}.remove-pending{background:none;border:0;color:var(--muted);cursor:pointer}
</style>
</head>
<body>
<header>
  <div id="title-row" class="title-row">
    <span class="state-dot ${stateClass}" aria-hidden="true"></span>
    <span class="title-prefix">Pull Request #${pr.number}</span>
    <span id="title-text" class="title-text">${escHtml(pr.title)}</span>
    <input id="title-input" class="title-input" type="text" aria-label="Pull request title" value="${escHtml(pr.title)}">
    <button id="edit-title" class="icon-btn" title="Edit title" aria-label="Edit pull request title">${editIcon}</button>
    <button id="refresh" class="icon-btn" title="Refresh pull request" aria-label="Refresh pull request">${refreshIcon}</button>
  </div>
  <div class="meta-row"><span class="badge ${stateClass}">${stateLabel}</span><span>by <strong>${escHtml(pr.user.login)}</strong></span><span>${escHtml(new Date(pr.created_at).toLocaleDateString())}</span>${labelsHtml}${assigneesHtml}${milestoneHtml}</div>
  <div class="review-row"><span class="context-label">Review</span><span class="review-state review-${reviewStatus}">${reviewLabel}</span></div>
  <div class="branch-row"><span class="context-label">Source branch</span><span class="branch-tag">${escHtml(pr.head.ref)}</span><span>→</span><span class="context-label">Base branch</span>${isOpen ? `<select id="base-select" class="branch-select" aria-label="Base branch">${branchOptions}</select>` : `<span class="branch-tag">${escHtml(pr.base.ref)}</span>`}</div>
</header>
<div class="actions"><button id="open-browser" class="btn">Open in Browser</button><button id="checkout" class="btn sec">Checkout</button>${isOpen ? `<select id="merge-method" aria-label="Merge method"><option value="merge">Merge commit</option><option value="rebase">Rebase</option><option value="squash">Squash</option></select><button id="merge" class="btn success">Merge PR</button><button id="change-state" class="btn danger">Close PR</button>` : pr.state === "closed" && !pr.merged ? '<button id="change-state" class="btn success">Re-open</button>' : ""}</div>
<nav class="tabs" role="tablist" aria-label="Pull request detail sections"><button class="tab" id="discussion-tab" data-tab="discussion" role="tab" aria-selected="false">${discussionIcon}<span>Discussion (${comments.length})</span></button><button class="tab active" id="reviews-tab" data-tab="reviews" role="tab" aria-selected="true">Reviews (${activeReviews.length})</button><button class="tab" id="commits-tab" data-tab="commits" role="tab" aria-selected="false">Commits (${commits.length})</button></nav>
<section id="tab-discussion" class="tab-content" role="tabpanel" aria-labelledby="discussion-tab">
  <section class="section-card"><div class="section-bar"><span>Description</span><button id="edit-body" class="icon-btn" title="Edit description" aria-label="Edit pull request description">${editIcon}</button></div><div id="body-view" class="section-content">${bodyHtml ? `<div class="markdown-body">${bodyHtml}</div>` : '<div class="empty">(no description)</div>'}</div><div id="body-editor" class="description-editor" hidden><textarea id="body-input">${escHtml(pr.body || "")}</textarea><div class="editor-actions"><button id="save-body" class="btn">Save</button><button id="cancel-body" class="btn sec">Cancel</button></div></div></section>
  <div class="section-bar"><span>Comments (${comments.length})</span></div><div>${commentsHtml}</div><div class="form-section"><textarea id="comment-body" aria-label="Add a comment" style="height:70px" placeholder="Write a comment..."></textarea><div class="editor-actions"><button id="post-comment" class="btn">Post Comment</button></div></div>
</section>
<section id="tab-reviews" class="tab-content active" role="tabpanel" aria-labelledby="reviews-tab">
  <div class="review-submit"><strong>Review</strong><textarea id="review-body" style="height:70px;margin-top:8px" placeholder="Overall review comment (optional)..."></textarea><div class="review-actions"><button class="btn" data-review-event="COMMENT">Comment</button>${isOpen ? '<button class="btn success" data-review-event="APPROVED">Approve</button><button class="btn danger" data-review-event="REQUEST_CHANGES">Request Changes</button>' : ""}</div><div class="review-batch-actions"><button id="submit-inline" class="btn sec submit-inline">Submit inline comments</button><span id="pending-inline-label" class="pending-label">Pending inline comments: 0</span></div></div>
  ${filesHtml}
  <h2 class="section-heading">Submitted Reviews</h2>${reviewsHtml}
</section>
<section id="tab-commits" class="tab-content" role="tabpanel" aria-labelledby="commits-tab">${commitsHtml}</section>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let pendingComments=[];let openFormKey=null;let titleCancelled=false;const originalTitle=${JSON.stringify(pr.title)};
function post(command,extra){vscode.postMessage(Object.assign({command},extra||{}));}
function showTab(name,button){document.querySelectorAll('.tab-content').forEach((el)=>el.classList.remove('active'));document.querySelectorAll('.tab').forEach((el)=>{el.classList.remove('active');el.setAttribute('aria-selected','false');});document.getElementById('tab-'+name)?.classList.add('active');button.classList.add('active');button.setAttribute('aria-selected','true');}
function setTitleEditing(editing){document.getElementById('title-row').classList.toggle('editing',editing);if(editing){titleCancelled=false;const input=document.getElementById('title-input');input.focus();input.select();}}
function saveTitle(){if(titleCancelled)return;const input=document.getElementById('title-input');const title=(input.value||'').trim();if(!title){input.value=originalTitle;setTitleEditing(false);return;}if(title===originalTitle){setTitleEditing(false);return;}post('editTitle',{title});}
function setBodyEditing(editing){document.getElementById('body-view').hidden=editing;document.getElementById('body-editor').hidden=!editing;if(editing)document.getElementById('body-input')?.focus();}
function submitReview(event){post('submitReview',{event,body:document.getElementById('review-body').value||'',comments:pendingComments.filter(Boolean)});}
function updatePendingCount(){const count=pendingComments.filter(Boolean).length;const submit=document.getElementById('submit-inline');const label=document.getElementById('pending-inline-label');if(submit)submit.classList.toggle('visible',count>0);if(label)label.textContent='Pending inline comments: '+count;}
document.getElementById('edit-title')?.addEventListener('click',()=>setTitleEditing(true));document.getElementById('title-input')?.addEventListener('blur',saveTitle);document.getElementById('title-input')?.addEventListener('keydown',(event)=>{if(event.key==='Escape'){titleCancelled=true;event.currentTarget.value=originalTitle;setTitleEditing(false);}else if(event.key==='Enter'){event.preventDefault();saveTitle();}});
document.getElementById('refresh')?.addEventListener('click',()=>post('refresh'));document.getElementById('edit-body')?.addEventListener('click',()=>setBodyEditing(true));document.getElementById('cancel-body')?.addEventListener('click',()=>setBodyEditing(false));document.getElementById('save-body')?.addEventListener('click',()=>post('editBody',{body:document.getElementById('body-input').value||''}));document.getElementById('base-select')?.addEventListener('change',(event)=>{const base=event.target.value;if(base)post('updateBase',{base});});
document.getElementById('open-browser')?.addEventListener('click',()=>post('openInBrowser'));document.getElementById('checkout')?.addEventListener('click',()=>post('checkout'));document.getElementById('merge')?.addEventListener('click',()=>post('merge',{method:document.getElementById('merge-method').value}));document.getElementById('change-state')?.addEventListener('click',()=>post('${isOpen ? "closePR" : "reopenPR"}'));document.getElementById('post-comment')?.addEventListener('click',()=>{const input=document.getElementById('comment-body');const body=(input.value||'').trim();if(!body)return;post('addComment',{body});input.value='';});document.querySelectorAll('[data-tab]').forEach((button)=>button.addEventListener('click',()=>showTab(button.dataset.tab,button)));document.querySelectorAll('[data-review-event]').forEach((button)=>button.addEventListener('click',()=>submitReview(button.dataset.reviewEvent)));document.getElementById('submit-inline')?.addEventListener('click',()=>submitReview('COMMENT'));
document.querySelectorAll('[data-file-toggle]').forEach((button)=>button.addEventListener('click',()=>{const index=button.dataset.fileToggle;const diff=document.getElementById('file-diff-'+index);const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));if(diff)diff.hidden=expanded;}));document.querySelectorAll('.clickable-line').forEach((row)=>row.addEventListener('click',()=>{const key=row.dataset.fileIndex+'-'+row.dataset.pos;const form=document.getElementById('comment-form-'+key);if(!form)return;if(openFormKey&&openFormKey!==key){const previous=document.getElementById('comment-form-'+openFormKey);if(previous)previous.hidden=true;}form.hidden=!form.hidden;openFormKey=form.hidden?null:key;if(!form.hidden)form.querySelector('textarea')?.focus();}));document.querySelectorAll('.cancel-inline').forEach((button)=>button.addEventListener('click',(event)=>{event.stopPropagation();button.closest('tr').hidden=true;openFormKey=null;}));document.querySelectorAll('.add-inline').forEach((button)=>button.addEventListener('click',(event)=>{event.stopPropagation();const row=button.closest('tr');const input=row.querySelector('textarea');const body=(input.value||'').trim();if(!body)return;const index=pendingComments.length;pendingComments.push({path:row.dataset.path,new_position:parseInt(row.dataset.newLine||'0',10),old_position:parseInt(row.dataset.oldLine||'0',10),body});const pending=document.createElement('tr');pending.innerHTML='<td colspan="3"><div class="pending-review-comment"><span class="pending-body"></span><button class="remove-pending" title="Remove">×</button></div></td>';pending.querySelector('.pending-body').textContent=body;pending.querySelector('.remove-pending').addEventListener('click',()=>{pendingComments[index]=null;pending.remove();updatePendingCount();});row.after(pending);row.hidden=true;input.value='';openFormKey=null;updatePendingCount();}));document.querySelectorAll('.markdown-body a[href]').forEach((link)=>link.addEventListener('click',(event)=>{event.preventDefault();post('openExternal',{url:link.getAttribute('href')});}));updatePendingCount();
</script>
</body>
</html>`;
  }

  dispose(): void {
    PRDetailPanel.panels.delete(this.pr.number);
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}

function getNonce(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return value;
}

function escHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}