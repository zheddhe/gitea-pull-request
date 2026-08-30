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
import {
  buildReviewConversations,
  conversationCommentIds,
  type ReviewConversation,
} from "../features/pullRequests/domain/reviewConversationModel";
import { log } from "../debug/outputChannel";

const REPLY_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.7 3 2 7l4.7 4V8.5c3.4 0 5.5 1 7.3 3.5-.5-4.6-2.8-7-7.3-7V3z"/></svg>`;
const RESOLVE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m6.4 11.2-3-3 .8-.8 2.2 2.2 5.4-5.4.8.8-6.2 6.2z"/></svg>`;
const REOPEN_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.2 3.8A6 6 0 1 0 14 9h-1.2a4.8 4.8 0 1 1-.7-4.3L10 6h5V1l-1.8 2.8z"/></svg>`;
const RESOLVED_EVENT_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m6.4 11.2-3-3 .8-.8 2.2 2.2 5.4-5.4.8.8-6.2 6.2z"/></svg>`;
const EXPAND_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m4.2 6.2 3.8 3.8 3.8-3.8.8.8L8 11.6 3.4 7l.8-.8z"/></svg>`;
const COLLAPSE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m4.2 9.8 3.8-3.8 3.8 3.8.8-.8L8 4.4 3.4 9l.8.8z"/></svg>`;

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

interface DiffRowsResult {
  html: string;
  matchedCommentIds: Set<number>;
}

interface ReviewCapabilities {
  version: string;
  inlineReviewResolution: boolean;
  inlineReviewReplies: boolean;
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
      result.push({
        type: "ctx",
        content: raw.slice(1),
        oldLine,
        newLine,
        pos,
      });
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
      await existing.update(pr);
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
      case "submitInlineReview":
        await this.submitInlineComments(
          (message.comments as Array<{
            path: string;
            new_position: number;
            old_position: number;
            body: string;
          }>) ?? [],
        );
        break;
      case "replyInlineComment":
        await this.replyInlineComment(
          Number(message.commentId),
          (message.body as string) ?? "",
        );
        break;
      case "resolveInlineConversation":
        await this.setInlineConversationResolved(Number(message.commentId), true);
        break;
      case "reopenInlineConversation":
        await this.setInlineConversationResolved(Number(message.commentId), false);
        break;
      case "addComment":
        await this.addPRComment((message.body as string) ?? "");
        break;
      case "editComment":
        await this.editPRComment(
          Number(message.commentId),
          (message.body as string) ?? "",
        );
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
      default:
        log(`PR unknown message: ${message.command}`);
    }
  }

  private async replyInlineComment(commentId: number, body: string): Promise<void> {
    if (!Number.isFinite(commentId) || commentId <= 0 || !body.trim()) return;
    try {
      await vscode.commands.executeCommand(
        "gitea.replyInlineReviewComment",
        this.repoInfo,
        this.pr.number,
        commentId,
        body.trim(),
      );
      await this.update(this.pr);
      vscode.window.showInformationMessage(
        `Reply posted on PR #${this.pr.number}.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to reply to inline review comment: ${(error as Error).message}`,
      );
    }
  }

  private async setInlineConversationResolved(
    commentId: number,
    resolved: boolean,
  ): Promise<void> {
    if (!Number.isFinite(commentId) || commentId <= 0) return;
    try {
      await vscode.commands.executeCommand(
        resolved
          ? "gitea.resolveInlineReviewConversation"
          : "gitea.reopenInlineReviewConversation",
        this.repoInfo,
        commentId,
      );
      await this.update(this.pr);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to ${resolved ? "resolve" : "reopen"} inline review conversation: ${(error as Error).message}`,
      );
    }
  }

  private async loadReviewCapabilities(): Promise<ReviewCapabilities> {
    try {
      const capabilities = await vscode.commands.executeCommand<ReviewCapabilities>(
        "gitea.getReviewCapabilities",
        this.repoInfo,
      );
      if (capabilities) return capabilities;
    } catch (error) {
      log(`[review-capabilities] unavailable: ${(error as Error).message}`);
    }
    return {
      version: "",
      inlineReviewResolution: false,
      inlineReviewReplies: false,
    };
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
    params: { title?: string; body?: string },
    successLabel: string,
  ): Promise<void> {
    if (params.title !== undefined && !params.title.trim()) {
      vscode.window.showWarningMessage("Title cannot be empty.");
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

  private async submitInlineComments(
    comments: Array<{
      path: string;
      new_position: number;
      old_position: number;
      body: string;
    }>,
  ): Promise<void> {
    if (comments.length === 0) return;
    try {
      await this.api.createReview(
        this.repoInfo,
        this.pr.number,
        "COMMENT",
        "",
        comments,
      );
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
      vscode.window.showInformationMessage(
        `${comments.length} inline comment(s) submitted on PR #${this.pr.number}.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to submit inline comments: ${(error as Error).message}`,
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

  private async editPRComment(commentId: number, body: string): Promise<void> {
    if (!Number.isFinite(commentId) || commentId <= 0 || !body.trim()) return;
    try {
      await this.api.updateComment(this.repoInfo, commentId, body.trim());
      await this.update(this.pr);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to edit comment: ${(error as Error).message}`);
    }
  }

  async update(pr: GiteaPullRequest): Promise<void> {
    log(`PR update: #${pr.number}`);
    try {
      const [comments, reviews, files, commits, reviewComments, rawDiff] =
        await Promise.all([
          this.api.listPRComments(this.repoInfo, pr.number),
          this.api.listReviews(this.repoInfo, pr.number),
          this.api.listPRFiles(this.repoInfo, pr.number),
          this.api.listPRCommits(this.repoInfo, pr.number),
          this.api
            .listAllPRReviewComments(this.repoInfo, pr.number)
            .catch(() => [] as GiteaReviewComment[]),
          this.api.getPRRawDiff(this.repoInfo, pr.number).catch(() => ""),
        ]);
      const capabilities = await this.loadReviewCapabilities();

      const patchMap = parseRawDiff(rawDiff);
      const enrichedFiles = files.map((file) => ({
        ...file,
        patch: patchMap.get(file.filename) ?? file.patch ?? "",
      }));
      const markdownSources = [
        pr.body ?? "",
        ...comments.map((comment) => comment.body ?? ""),
        ...reviews.map((review) => review.body ?? ""),
        ...reviewComments.map((comment) => comment.body ?? ""),
      ];
      const renderedMarkdown = await Promise.all(
        markdownSources.map((source) => this.renderMarkdown(source)),
      );
      const bodyHtml = renderedMarkdown[0] ?? "";
      const commentStart = 1;
      const reviewStart = commentStart + comments.length;
      const reviewCommentStart = reviewStart + reviews.length;
      const commentBodies = renderedMarkdown.slice(commentStart, reviewStart);
      const reviewBodies = renderedMarkdown.slice(reviewStart, reviewCommentStart);
      const reviewCommentBodies = renderedMarkdown.slice(reviewCommentStart);

      this.panel.webview.html = this.renderHtml(
        pr,
        comments,
        reviews,
        enrichedFiles,
        commits,
        reviewComments,
        bodyHtml,
        commentBodies,
        reviewBodies,
        reviewCommentBodies,
        capabilities,
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

  private renderReviewConversation(
    conversation: ReviewConversation,
    reviewCommentBodies: Map<number, string>,
    capabilities: ReviewCapabilities,
    standalone = false,
  ): string {
    const root = conversation.root;
    const resolvedControls = conversation.resolved
      ? `<span class="conversation-event-actions"><button class="icon-btn conversation-collapse-toggle" data-comment-id="${root.id}" title="Expand conversation" aria-label="Expand resolved review conversation" aria-expanded="false"><span class="expand-icon">${EXPAND_ICON}</span><span class="collapse-icon">${COLLAPSE_ICON}</span></button>${!conversation.orphaned && capabilities.inlineReviewResolution ? `<button class="icon-btn reopen-conversation" data-comment-id="${root.id}" title="Reopen conversation" aria-label="Reopen review conversation">${REOPEN_ICON}</button>` : ""}</span>`
      : "";
    const resolvedEventHtml = conversation.resolved
      ? `<div class="conversation-event resolved-event">${RESOLVED_EVENT_ICON}<span><strong>${escHtml(root.resolver?.login || "Someone")}</strong> resolved this conversation</span>${resolvedControls}</div>`
      : "";
    const orphanHtml = conversation.orphaned
      ? '<span class="conversation-state muted">Reply parent unavailable</span>'
      : "";
    const repliesHtml = conversation.replies
      .map(
        (reply) =>
          `<div class="review-reply"><div class="review-comment-header"><strong>${escHtml(reply.user.login)}</strong><span class="muted">${escHtml(new Date(reply.created_at).toLocaleString())}</span></div><div class="review-comment-body markdown-body">${reviewCommentBodies.get(reply.id) ?? escHtml(reply.body)}</div></div>`,
      )
      .join("");
    const actions: string[] = [];
    if (!conversation.orphaned && capabilities.inlineReviewReplies) {
      actions.push(
        `<button class="icon-btn reply-toggle" data-comment-id="${root.id}" title="Reply to conversation" aria-label="Reply to review conversation">${REPLY_ICON}</button>`,
      );
    }
    if (
      !conversation.orphaned &&
      capabilities.inlineReviewResolution &&
      !conversation.resolved
    ) {
      actions.push(
        `<button class="icon-btn resolve-conversation" data-comment-id="${root.id}" title="Resolve conversation" aria-label="Resolve review conversation">${RESOLVE_ICON}</button>`,
      );
    }
    const actionHtml = actions.length
      ? `<div class="conversation-actions">${actions.join("")}</div>`
      : "";
    const replyForm = !conversation.orphaned && capabilities.inlineReviewReplies
      ? `<div class="reply-form" id="reply-form-${root.id}" hidden><textarea aria-label="Reply to inline review comment" placeholder="Reply to this review conversation..."></textarea><div class="inline-actions"><button class="btn submit-reply" data-comment-id="${root.id}">Reply</button><button class="btn sec cancel-reply" data-comment-id="${root.id}">Cancel</button></div></div>`
      : "";
    const contentHtml = `<div class="conversation-content"><div class="review-comment-card conversation-root"><div class="review-comment-header"><strong>${escHtml(root.user.login)}</strong><span class="muted">${escHtml(new Date(root.created_at).toLocaleString())}</span>${orphanHtml}</div><div class="review-comment-body markdown-body">${reviewCommentBodies.get(root.id) ?? escHtml(root.body)}</div></div>${repliesHtml}${actionHtml}${replyForm}</div>`;
    return `<div class="review-conversation${conversation.resolved ? " conversation-resolved conversation-collapsed" : ""}${standalone ? " standalone" : ""}" data-root-comment-id="${root.id}">${resolvedEventHtml}${contentHtml}</div>`;
  }

  private buildDiffRows(
    patch: string,
    fileIndex: number,
    filename: string,
    reviewConversations: ReviewConversation[],
    reviewCommentBodies: Map<number, string>,
    capabilities: ReviewCapabilities,
  ): DiffRowsResult {
    const lines = parsePatch(patch);
    const matchedCommentIds = new Set<number>();
    if (lines.length === 0) {
      return {
        html: '<tr><td colspan="3" class="empty-diff">No diff available</td></tr>',
        matchedCommentIds,
      };
    }

    const byNewLine = new Map<number, ReviewConversation[]>();
    const byOldLine = new Map<number, ReviewConversation[]>();
    for (const conversation of reviewConversations.filter(
      (item) => !item.orphaned && item.root.path === filename,
    )) {
      const root = conversation.root;
      if ((root.new_position ?? 0) > 0) {
        const line = root.new_position as number;
        byNewLine.set(line, [...(byNewLine.get(line) ?? []), conversation]);
      }
      if ((root.old_position ?? 0) > 0) {
        const line = root.old_position as number;
        byOldLine.set(line, [...(byOldLine.get(line) ?? []), conversation]);
      }
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

      const lineConversations = new Map<number, ReviewConversation>();
      if (line.newLine !== undefined) {
        for (const conversation of byNewLine.get(line.newLine) ?? []) {
          lineConversations.set(conversation.root.id, conversation);
        }
      }
      if (line.oldLine !== undefined) {
        for (const conversation of byOldLine.get(line.oldLine) ?? []) {
          lineConversations.set(conversation.root.id, conversation);
        }
      }
      for (const conversation of lineConversations.values()) {
        for (const id of conversationCommentIds(conversation)) {
          matchedCommentIds.add(id);
        }
        rows += `<tr class="existing-review-comment"><td colspan="3">${this.renderReviewConversation(conversation, reviewCommentBodies, capabilities)}</td></tr>`;
      }
    }
    return { html: rows, matchedCommentIds };
  }

  private renderHtml(
    pr: GiteaPullRequest,
    comments: GiteaComment[],
    reviews: GiteaReview[],
    files: (GiteaFileDiff & { patch: string })[],
    commits: GiteaCommit[],
    reviewComments: GiteaReviewComment[],
    bodyHtml: string,
    commentBodies: string[],
    reviewBodies: string[],
    reviewCommentBodies: string[],
    capabilities: ReviewCapabilities,
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

    const editIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.3 1.7a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8.6 8.6-3.2.7.7-3.2 8.1-9.1zm.7 1.1-7.9 8.8-.3 1.1 1.1-.3 8.3-8.3L12 2.8z"/></svg>`;
    const refreshIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.2 3.8A6 6 0 1 0 14 9h-1.2a4.8 4.8 0 1 1-.7-4.3L10 6h5V1l-1.8 2.8z"/></svg>`;
    const externalIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9 2h5v5h-1V3.7L7.35 9.35l-.7-.7L12.3 3H9V2zM3 4h4v1H4v7h7V8h1v5H3V4z"/></svg>`;

    const commentsHtml = comments.length
      ? comments
          .map(
            (comment, index) =>
              `<article class="comment" data-comment-id="${comment.id}"><header class="comment-header"><img src="${escHtml(comment.user.avatar_url)}" class="avatar" alt=""><strong>${escHtml(comment.user.login)}</strong><span class="time">${escHtml(new Date(comment.created_at).toLocaleString())}</span><button class="icon-btn edit-comment" data-comment-id="${comment.id}" title="Edit comment" aria-label="Edit comment by ${escHtml(comment.user.login)}">${editIcon}</button></header><div id="comment-view-${comment.id}" class="comment-body markdown-body">${commentBodies[index] ?? ""}</div><div id="comment-editor-${comment.id}" class="comment-editor" hidden><textarea id="comment-input-${comment.id}">${escHtml(comment.body ?? "")}</textarea><div class="editor-actions"><button class="btn save-comment" data-comment-id="${comment.id}">Save</button><button class="btn sec cancel-comment" data-comment-id="${comment.id}">Cancel</button></div></div></article>`,
          )
          .join("")
      : '<p class="empty">No comments yet.</p>';

    const reviewsHtml = activeReviews.length
      ? activeReviews
          .map((review) => {
            const sourceIndex = reviews.indexOf(review);
            const state = review.state.toLowerCase();
            const label = review.state.replace(/_/g, " ");
            const inlineComments = reviewComments
              .filter((comment) => comment.pull_request_review_id === review.id)
              .sort(
                (left, right) =>
                  new Date(left.created_at).getTime() -
                  new Date(right.created_at).getTime(),
              );
            const inlineHtml = inlineComments.length
              ? `<div class="review-inline-summary"><strong>${inlineComments.length} inline comment${inlineComments.length === 1 ? "" : "s"}</strong>${inlineComments
                  .map((comment) => {
                    const commentIndex = reviewComments.indexOf(comment);
                    const line = comment.position || comment.original_position;
                    const location = line
                      ? `${comment.path}:${line}`
                      : comment.path;
                    return `<div class="review-inline-message"><div class="review-inline-location"><code>${escHtml(location)}</code><span class="time">${escHtml(new Date(comment.created_at).toLocaleString())}</span></div><div class="markdown-body">${reviewCommentBodies[commentIndex] ?? escHtml(comment.body)}</div></div>`;
                  })
                  .join("")}</div>`
              : "";
            return `<article class="submitted-review submitted-review-${state}" data-review-time="${new Date(review.submitted_at).getTime()}"><header class="review-header"><strong>${escHtml(review.user.login)}</strong><span class="review-badge review-badge-${state}">${escHtml(label)}</span><span class="time">${escHtml(new Date(review.submitted_at).toLocaleString())}</span></header>${review.body?.trim() ? `<div class="review-body markdown-body">${reviewBodies[sourceIndex] ?? ""}</div>` : ""}${inlineHtml}</article>`;
          })
          .join("")
      : '<p class="empty">No review events yet.</p>';

    const commitsHtml = commits.length
      ? commits
          .map(
            (commit) =>
              `<article class="commit-entry"><code class="sha">${escHtml(commit.sha.slice(0, 8))}</code><span class="commit-message">${escHtml(commit.commit.message.split("\n")[0])}</span><span class="commit-author">${escHtml(commit.commit.author.name)}</span></article>`,
          )
          .join("")
      : '<p class="empty">No commits.</p>';

    const reviewCommentBodyById = new Map<number, string>();
    reviewComments.forEach((comment, index) => {
      reviewCommentBodyById.set(comment.id, reviewCommentBodies[index] ?? "");
    });
    const reviewConversations = buildReviewConversations(reviewComments);
    const matchedReviewCommentIds = new Set<number>();
    const filesHtml = files
      .map((file, fileIndex) => {
        const diffRows = this.buildDiffRows(
          file.patch,
          fileIndex,
          file.filename,
          reviewConversations,
          reviewCommentBodyById,
          capabilities,
        );
        for (const id of diffRows.matchedCommentIds) matchedReviewCommentIds.add(id);
        const statusClass = `file-status-${file.status}`;
        return `<section class="file-block"><button class="file-header" data-file-toggle="${fileIndex}" aria-expanded="false"><span class="file-status ${statusClass}">${escHtml(file.status.slice(0, 1).toUpperCase())}</span><span class="file-path">${escHtml(file.filename)}</span><span class="file-stats"><span class="additions">+${file.additions}</span> <span class="deletions">-${file.deletions}</span></span><span class="chevron">›</span></button><div class="file-diff" id="file-diff-${fileIndex}" hidden><table class="diff-table"><tbody>${diffRows.html}</tbody></table></div></section>`;
      })
      .join("");

    const unplacedConversations = reviewConversations.filter((conversation) =>
      conversationCommentIds(conversation).every(
        (id) => !matchedReviewCommentIds.has(id),
      ),
    );
    const unplacedInlineHtml = unplacedConversations.length
      ? `<section class="unplaced-inline"><h2 class="section-heading">Unplaced inline conversations (${unplacedConversations.length})</h2><p class="muted">These conversations cannot be safely attached to a line in the current diff.</p>${unplacedConversations
          .map((conversation) => this.renderReviewConversation(conversation, reviewCommentBodyById, capabilities, true))
          .join("")}</section>`
      : "";
    const replyCapabilityHtml = capabilities.inlineReviewReplies
      ? ""
      : `<span class="capability-note" title="Inline review replies require Gitea 1.27.0 or newer. Server: ${escHtml(capabilities.version || "unknown")}">Replies require Gitea 1.27+</span>`;

    const discussionIcon = `<svg class="tab-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h12v9H7.2L4 13.7V11H2V2zm1 1v7h2v1.55L6.8 10H13V3H3z"/></svg>`;
    const inlineIcon = `<svg class="tab-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h12v8H8l-3.5 3V10H2V2zm1 1v6h2.5v1.8L7.6 9H13V3H3zM5 5h6v1H5V5zm0 2h4v1H5V7z"/></svg>`;
    const historyIcon = `<svg class="tab-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 2a6 6 0 1 1-5.2 3H1V4h3v3H3V5.8A5 5 0 1 0 8 3V2zm-.5 2h1v4.2l2.6 1.5-.5.9-3.1-1.8V4z"/></svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR #${pr.number}</title>
<style>
:root{--surface:var(--vscode-editor-background);--subtle:var(--vscode-textBlockQuote-background,var(--vscode-editor-inactiveSelectionBackground));--fg:var(--vscode-foreground);--muted:var(--vscode-descriptionForeground);--border:var(--vscode-panel-border,var(--vscode-widget-border));--focus:var(--vscode-focusBorder);--input-bg:var(--vscode-input-background);--input-fg:var(--vscode-input-foreground);--input-border:var(--vscode-input-border,transparent);--button-bg:var(--vscode-button-background);--button-fg:var(--vscode-button-foreground);--button-secondary-bg:var(--vscode-button-secondaryBackground);--button-secondary-fg:var(--vscode-button-secondaryForeground);--success:var(--vscode-testing-iconPassed,var(--vscode-charts-green));--danger:var(--vscode-testing-iconFailed,var(--vscode-errorForeground));--warning:var(--vscode-editorWarning-foreground,var(--vscode-charts-yellow));--info:var(--vscode-textLink-foreground);--merged:var(--vscode-charts-purple);--mono:var(--vscode-editor-font-family)}
*{box-sizing:border-box}html,body{margin:0;background:var(--surface);color:var(--fg)}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);line-height:1.45;padding:16px 20px}button,input,textarea,select{font:inherit}
.title-row{display:flex;align-items:center;gap:7px;min-width:0;margin-bottom:5px;white-space:nowrap}.title-prefix{font-size:1.22em;font-weight:600;flex:0 0 auto}.title-text{font-size:1.22em;font-weight:600;overflow:hidden;text-overflow:ellipsis}.title-input{display:none;min-width:180px;width:min(520px,45vw);font-size:1.22em;font-weight:600;padding:1px 5px}.title-row.editing .title-text{display:none}.title-row.editing .title-input{display:inline-block}.state-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:currentColor}.state-open{color:var(--success)}.state-closed{color:var(--danger)}.state-merged{color:var(--merged)}.review-state{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.82em;font-weight:600}.review-approved{color:var(--success)}.review-changes-requested{color:var(--danger)}.review-pending{color:var(--warning)}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:2px;border:0;border-radius:3px;background:transparent;color:var(--muted);cursor:pointer}.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground,var(--subtle));color:var(--fg)}.icon-btn svg{width:14px;height:14px}.meta-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;color:var(--muted);font-size:.92em;margin-bottom:12px}.meta-row strong{color:var(--fg)}.badge{display:inline-flex;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.82em;font-weight:600;text-transform:uppercase}.label{border:1px solid var(--label-color);border-radius:999px;padding:1px 7px;font-size:.78em}
.btn{border:1px solid transparent;border-radius:2px;padding:4px 10px;min-height:26px;cursor:pointer;background:var(--button-bg);color:var(--button-fg)}.btn.sec{background:var(--button-secondary-bg);color:var(--button-secondary-fg)}.btn:focus-visible,.icon-btn:focus-visible,.tab:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.file-header:focus-visible{outline:1px solid var(--focus);outline-offset:2px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:14px}.tab{display:inline-flex;align-items:center;gap:6px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--muted);cursor:pointer;padding:6px 10px}.tab.active{color:var(--fg);border-bottom-color:var(--focus);font-weight:600}.tab-icon{width:15px;height:15px}.tab-content{display:none}.tab-content.active{display:block}
.section-card,.comment,.submitted-review,.file-block,.inline-review-toolbar{border:1px solid var(--border);border-radius:3px;margin-bottom:10px;overflow:hidden}.section-card{margin-bottom:14px}.section-bar,.comment-header,.review-header{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--subtle);border-bottom:1px solid var(--border)}.section-bar{justify-content:space-between;font-weight:600}.section-content,.comment-body,.review-body{padding:10px 12px}.description-editor,.comment-editor,.inline-comment-form{padding:10px 12px;background:var(--subtle)}.description-editor textarea{min-height:140px}.comment-editor textarea{min-height:90px}.editor-actions,.inline-actions,.review-batch-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.inline-review-toolbar{padding:9px 10px;background:var(--subtle);display:flex;align-items:center;gap:8px}.pending-label{color:var(--muted);font-size:.9em}.capability-note{margin-left:auto;color:var(--muted);font-size:.82em}.submit-inline{display:none}.submit-inline.visible{display:inline-flex}
textarea,input[type="text"],select{background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:2px;padding:6px 8px}textarea,input[type="text"]{width:100%;resize:vertical}.markdown-body{line-height:1.5;overflow-wrap:anywhere}.markdown-body h1{font-size:1.28em}.markdown-body h2{font-size:1.16em}.markdown-body h3{font-size:1.06em}.markdown-body code,.sha,.file-path,.diff-table{font-family:var(--mono)}.markdown-body pre{overflow:auto}.avatar{width:20px;height:20px;border-radius:50%}.time{margin-left:auto;color:var(--muted);font-size:.92em}.empty,.muted{color:var(--muted)}
.submitted-review{border-left-width:3px}.submitted-review-approved{border-left-color:var(--success)}.submitted-review-request_changes{border-left-color:var(--danger)}.submitted-review-comment,.submitted-review-commented{border-left-color:var(--info)}.review-badge{font-size:.78em;border:1px solid currentColor;border-radius:999px;padding:1px 6px}.review-badge-approved{color:var(--success)}.review-badge-request_changes{color:var(--danger)}.review-badge-comment,.submitted-review-commented{color:var(--info)}.section-heading{font-size:1em;font-weight:600;margin:14px 0 8px}.review-history-toolbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin:0 0 10px}.review-history-toolbar label{color:var(--muted);font-size:.9em}.review-history-toolbar select{width:auto;min-width:130px}.review-inline-summary{border-top:1px solid var(--border);padding:8px 10px}.review-inline-summary>strong{display:block;margin-bottom:6px}.review-inline-message{padding:7px 0;border-top:1px solid var(--border)}.review-inline-message:first-of-type{border-top:0}.review-inline-location{display:flex;align-items:center;gap:8px;color:var(--muted);margin-bottom:4px}.review-inline-location code{color:var(--fg)}
.commit-entry{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border)}.commit-author{color:var(--muted)}.file-header{width:100%;display:flex;align-items:center;gap:8px;border:0;background:var(--subtle);color:var(--fg);padding:7px 10px;cursor:pointer;text-align:left}.file-status{display:inline-flex;width:17px;height:17px;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:2px;font-size:.72em;font-weight:600}.file-status-added{color:var(--success)}.file-status-deleted{color:var(--danger)}.file-status-modified,.file-status-changed{color:var(--warning)}.file-status-renamed{color:var(--info)}.file-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}.additions{color:var(--success)}.deletions{color:var(--danger)}.chevron{color:var(--muted)}.file-diff{overflow:auto;border-top:1px solid var(--border)}.diff-table{width:100%;border-collapse:collapse;font-size:.9em;table-layout:fixed}.ln{width:44px;text-align:right;padding:0 6px;color:var(--muted);background:var(--subtle);border-right:1px solid var(--border)}.lc{padding:0 8px;white-space:pre}.lc pre{margin:0;font:inherit}.diff-add .lc{background:color-mix(in srgb,var(--success) 12%,transparent)}.diff-del .lc{background:color-mix(in srgb,var(--danger) 12%,transparent)}.diff-hunk td{background:color-mix(in srgb,var(--info) 10%,transparent);color:var(--info)}.clickable-line{cursor:pointer}.review-comment-card,.pending-review-comment{padding:8px 12px;background:var(--subtle)}.review-comment-card{border-left:3px solid var(--info)}.review-comment-header{display:flex;align-items:center;gap:8px}.review-comment-body{margin-top:6px}.pending-review-comment{border-left:3px dashed var(--warning);display:flex;gap:8px}.pending-body{flex:1}.remove-pending{background:none;border:0;color:var(--muted);cursor:pointer}
.review-conversation{position:relative;margin:8px 0;border:1px solid var(--border);border-left:3px solid var(--info);border-radius:3px;background:transparent;overflow:hidden}.review-conversation.standalone{margin:8px 0}.review-conversation.conversation-resolved{border-left-color:var(--success);opacity:.86}.conversation-event{display:flex;align-items:center;gap:7px;padding:5px 10px;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--success) 7%,var(--subtle));color:var(--muted);font-size:.86em}.conversation-event>svg{width:14px;height:14px;flex:0 0 14px;color:var(--success)}.conversation-event strong{color:var(--fg)}.conversation-event-actions{display:flex;align-items:center;gap:2px;margin-left:auto}.conversation-event-actions .icon-btn{width:24px;height:24px}.conversation-collapse-toggle .collapse-icon{display:none}.conversation-resolved:not(.conversation-collapsed) .conversation-collapse-toggle .expand-icon{display:none}.conversation-resolved:not(.conversation-collapsed) .conversation-collapse-toggle .collapse-icon{display:inline-flex}.conversation-resolved.conversation-collapsed .conversation-content{display:none}.conversation-resolved.conversation-collapsed .conversation-event{border-bottom:0}.conversation-root{border-left:0;background:var(--subtle);padding:10px 12px}.review-reply{position:relative;margin-left:22px;padding:9px 12px 9px 16px;border-top:1px solid var(--border);border-left:1px solid var(--border);background:color-mix(in srgb,var(--subtle) 55%,transparent)}.review-reply::before{content:"";position:absolute;left:-1px;top:17px;width:10px;border-top:1px solid var(--border)}.conversation-actions{display:flex;justify-content:flex-start;gap:2px;margin-left:22px;padding:5px 10px 7px 12px;border-left:1px solid var(--border)}.conversation-actions .icon-btn{width:24px;height:24px}.conversation-state{margin-left:auto;font-size:.82em}.reply-form{margin-left:22px;padding:9px 12px 11px 16px;border-top:1px solid var(--border);border-left:1px solid var(--border);background:color-mix(in srgb,var(--subtle) 45%,transparent)}.reply-form textarea{min-height:70px}.reply-form .inline-actions{justify-content:flex-end}
</style>
</head>
<body>
<header>
  <div id="title-row" class="title-row">
    <span class="state-dot ${stateClass}" aria-hidden="true"></span>
    <span class="review-state review-${reviewStatus}">${reviewLabel}</span>
    <span class="title-prefix">Pull Request #${pr.number}</span>
    <span id="title-text" class="title-text">${escHtml(pr.title)}</span>
    <input id="title-input" class="title-input" type="text" aria-label="Pull request title" value="${escHtml(pr.title)}">
    <button id="edit-title" class="icon-btn" title="Edit title" aria-label="Edit pull request title">${editIcon}</button>
    <button id="open-browser" class="icon-btn" title="Open in Browser" aria-label="Open pull request in browser">${externalIcon}</button>
    <button id="refresh" class="icon-btn" title="Refresh pull request" aria-label="Refresh pull request">${refreshIcon}</button>
  </div>
  <div class="meta-row"><span class="badge ${stateClass}">${stateLabel}</span><span>by <strong>${escHtml(pr.user.login)}</strong></span><span>${escHtml(new Date(pr.created_at).toLocaleDateString())}</span>${labelsHtml}${assigneesHtml}${milestoneHtml}</div>
</header>
<nav class="tabs" role="tablist" aria-label="Pull request detail sections"><button class="tab active" id="inline-reviews-tab" data-tab="inline-reviews" role="tab" aria-selected="true">${inlineIcon}<span>Inline Reviews (${reviewConversations.length})</span></button><button class="tab" id="review-history-tab" data-tab="review-history" role="tab" aria-selected="false">${historyIcon}<span>Review History (${activeReviews.length})</span></button><button class="tab" id="discussion-tab" data-tab="discussion" role="tab" aria-selected="false">${discussionIcon}<span>Discussion (${comments.length})</span></button><button class="tab" id="commits-tab" data-tab="commits" role="tab" aria-selected="false">Commits (${commits.length})</button></nav>
<section id="tab-inline-reviews" class="tab-content active" role="tabpanel" aria-labelledby="inline-reviews-tab">
  <div class="inline-review-toolbar"><button id="submit-inline" class="btn submit-inline">Submit inline comments</button><span id="pending-inline-label" class="pending-label">Pending inline comments: 0</span>${replyCapabilityHtml}</div>
  ${filesHtml}
  ${unplacedInlineHtml}
</section>
<section id="tab-review-history" class="tab-content" role="tabpanel" aria-labelledby="review-history-tab"><div class="review-history-toolbar"><label for="review-history-sort">Sort</label><select id="review-history-sort" aria-label="Sort review history"><option value="asc" selected>Oldest first</option><option value="desc">Newest first</option></select></div><div id="review-history-list">${reviewsHtml}</div></section>
<section id="tab-discussion" class="tab-content" role="tabpanel" aria-labelledby="discussion-tab">
  <section class="section-card"><div class="section-bar"><span>Description</span><button id="edit-body" class="icon-btn" title="Edit description" aria-label="Edit pull request description">${editIcon}</button></div><div id="body-view" class="section-content">${bodyHtml ? `<div class="markdown-body">${bodyHtml}</div>` : '<div class="empty">(no description)</div>'}</div><div id="body-editor" class="description-editor" hidden><textarea id="body-input">${escHtml(pr.body || "")}</textarea><div class="editor-actions"><button id="save-body" class="btn">Save</button><button id="cancel-body" class="btn sec">Cancel</button></div></div></section>
  <div class="section-bar"><span>Comments (${comments.length})</span></div><div>${commentsHtml}</div><div><textarea id="comment-body" aria-label="Add a comment" style="height:70px" placeholder="Write a comment..."></textarea><div class="editor-actions"><button id="post-comment" class="btn">Post Comment</button></div></div>
</section>
<section id="tab-commits" class="tab-content" role="tabpanel" aria-labelledby="commits-tab">${commitsHtml}</section>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const savedState=vscode.getState()||{};const expandedResolvedConversations=new Set(Array.isArray(savedState.expandedResolvedConversations)?savedState.expandedResolvedConversations.map(String):[]);let pendingComments=[];let openFormKey=null;let titleCancelled=false;const originalTitle=${JSON.stringify(pr.title)};
function post(command,extra){vscode.postMessage(Object.assign({command},extra||{}));}
function persistExpandedResolved(){vscode.setState(Object.assign({},vscode.getState()||{},{expandedResolvedConversations:Array.from(expandedResolvedConversations)}));}
function setResolvedConversationExpanded(conversation,expanded,persist=true){if(!conversation)return;const id=conversation.dataset.rootCommentId;conversation.classList.toggle('conversation-collapsed',!expanded);const toggle=conversation.querySelector('.conversation-collapse-toggle');if(toggle){toggle.setAttribute('aria-expanded',String(expanded));toggle.title=expanded?'Collapse conversation':'Expand conversation';toggle.setAttribute('aria-label',(expanded?'Collapse':'Expand')+' resolved review conversation');}if(id){if(expanded)expandedResolvedConversations.add(String(id));else expandedResolvedConversations.delete(String(id));}if(persist)persistExpandedResolved();}
function showTab(name,button,persist=true){document.querySelectorAll('.tab-content').forEach((el)=>el.classList.remove('active'));document.querySelectorAll('.tab').forEach((el)=>{el.classList.remove('active');el.setAttribute('aria-selected','false');});document.getElementById('tab-'+name)?.classList.add('active');button.classList.add('active');button.setAttribute('aria-selected','true');if(persist)vscode.setState(Object.assign({},vscode.getState()||{},{activeTab:name}));}
function setTitleEditing(editing){document.getElementById('title-row').classList.toggle('editing',editing);if(editing){titleCancelled=false;const input=document.getElementById('title-input');input.focus();input.select();}}
function saveTitle(){if(titleCancelled)return;const input=document.getElementById('title-input');const title=(input.value||'').trim();if(!title){input.value=originalTitle;setTitleEditing(false);return;}if(title===originalTitle){setTitleEditing(false);return;}post('editTitle',{title});}
function setBodyEditing(editing){document.getElementById('body-view').hidden=editing;document.getElementById('body-editor').hidden=!editing;if(editing)document.getElementById('body-input')?.focus();}
function setCommentEditing(id,editing){const view=document.getElementById('comment-view-'+id);const editor=document.getElementById('comment-editor-'+id);if(view)view.hidden=editing;if(editor)editor.hidden=!editing;if(editing)document.getElementById('comment-input-'+id)?.focus();}
function updatePendingCount(){const count=pendingComments.filter(Boolean).length;const submit=document.getElementById('submit-inline');const label=document.getElementById('pending-inline-label');if(submit)submit.classList.toggle('visible',count>0);if(label)label.textContent='Pending inline comments: '+count;}
function sortReviewHistory(direction){const list=document.getElementById('review-history-list');if(!list)return;const items=Array.from(list.querySelectorAll('.submitted-review'));items.sort((left,right)=>{const a=Number(left.dataset.reviewTime||0);const b=Number(right.dataset.reviewTime||0);return direction==='desc'?b-a:a-b;});items.forEach((item)=>list.appendChild(item));}
document.querySelectorAll('.conversation-resolved').forEach((conversation)=>setResolvedConversationExpanded(conversation,expandedResolvedConversations.has(String(conversation.dataset.rootCommentId)),false));
document.querySelectorAll('.conversation-collapse-toggle').forEach((button)=>button.addEventListener('click',()=>{const conversation=button.closest('.review-conversation');if(!conversation)return;setResolvedConversationExpanded(conversation,conversation.classList.contains('conversation-collapsed'));}));
document.getElementById('edit-title')?.addEventListener('click',()=>setTitleEditing(true));document.getElementById('title-input')?.addEventListener('blur',saveTitle);document.getElementById('title-input')?.addEventListener('keydown',(event)=>{if(event.key==='Escape'){titleCancelled=true;event.currentTarget.value=originalTitle;setTitleEditing(false);}else if(event.key==='Enter'){event.preventDefault();saveTitle();}});
document.getElementById('open-browser')?.addEventListener('click',()=>post('openInBrowser'));document.getElementById('refresh')?.addEventListener('click',()=>post('refresh'));document.getElementById('edit-body')?.addEventListener('click',()=>setBodyEditing(true));document.getElementById('cancel-body')?.addEventListener('click',()=>setBodyEditing(false));document.getElementById('save-body')?.addEventListener('click',()=>post('editBody',{body:document.getElementById('body-input').value||''}));
document.querySelectorAll('.edit-comment').forEach((button)=>button.addEventListener('click',()=>setCommentEditing(button.dataset.commentId,true)));document.querySelectorAll('.cancel-comment').forEach((button)=>button.addEventListener('click',()=>setCommentEditing(button.dataset.commentId,false)));document.querySelectorAll('.save-comment').forEach((button)=>button.addEventListener('click',()=>{const id=button.dataset.commentId;const input=document.getElementById('comment-input-'+id);const body=(input?.value||'').trim();if(!body)return;post('editComment',{commentId:Number(id),body});}));
document.querySelectorAll('.reply-toggle').forEach((button)=>button.addEventListener('click',()=>{const id=button.dataset.commentId;const form=document.getElementById('reply-form-'+id);if(!form)return;form.hidden=!form.hidden;if(!form.hidden)form.querySelector('textarea')?.focus();}));document.querySelectorAll('.cancel-reply').forEach((button)=>button.addEventListener('click',()=>{const form=document.getElementById('reply-form-'+button.dataset.commentId);if(form)form.hidden=true;}));document.querySelectorAll('.submit-reply').forEach((button)=>button.addEventListener('click',()=>{const id=button.dataset.commentId;const form=document.getElementById('reply-form-'+id);const input=form?.querySelector('textarea');const body=(input?.value||'').trim();if(!body)return;button.disabled=true;post('replyInlineComment',{commentId:Number(id),body});}));
document.querySelectorAll('.resolve-conversation').forEach((button)=>button.addEventListener('click',()=>{button.disabled=true;post('resolveInlineConversation',{commentId:Number(button.dataset.commentId)});}));document.querySelectorAll('.reopen-conversation').forEach((button)=>button.addEventListener('click',()=>{button.disabled=true;const id=String(button.dataset.commentId||'');if(id){expandedResolvedConversations.delete(id);persistExpandedResolved();}post('reopenInlineConversation',{commentId:Number(button.dataset.commentId)});}));
document.getElementById('post-comment')?.addEventListener('click',()=>{const input=document.getElementById('comment-body');const body=(input.value||'').trim();if(!body)return;post('addComment',{body});input.value='';});document.querySelectorAll('[data-tab]').forEach((button)=>button.addEventListener('click',()=>showTab(button.dataset.tab,button)));document.getElementById('submit-inline')?.addEventListener('click',()=>post('submitInlineReview',{comments:pendingComments.filter(Boolean)}));document.getElementById('review-history-sort')?.addEventListener('change',(event)=>sortReviewHistory(event.currentTarget.value));
document.querySelectorAll('[data-file-toggle]').forEach((button)=>button.addEventListener('click',()=>{const index=button.dataset.fileToggle;const diff=document.getElementById('file-diff-'+index);const expanded=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!expanded));if(diff)diff.hidden=expanded;}));document.querySelectorAll('.clickable-line').forEach((row)=>row.addEventListener('click',()=>{const key=row.dataset.fileIndex+'-'+row.dataset.pos;const form=document.getElementById('comment-form-'+key);if(!form)return;if(openFormKey&&openFormKey!==key){const previous=document.getElementById('comment-form-'+openFormKey);if(previous)previous.hidden=true;}form.hidden=!form.hidden;openFormKey=form.hidden?null:key;if(!form.hidden)form.querySelector('textarea')?.focus();}));document.querySelectorAll('.cancel-inline').forEach((button)=>button.addEventListener('click',(event)=>{event.stopPropagation();button.closest('tr').hidden=true;openFormKey=null;}));document.querySelectorAll('.add-inline').forEach((button)=>button.addEventListener('click',(event)=>{event.stopPropagation();const row=button.closest('tr');const input=row.querySelector('textarea');const body=(input.value||'').trim();if(!body)return;const index=pendingComments.length;pendingComments.push({path:row.dataset.path,new_position:parseInt(row.dataset.newLine||'0',10),old_position:parseInt(row.dataset.oldLine||'0',10),body});const pending=document.createElement('tr');pending.innerHTML='<td colspan="3"><div class="pending-review-comment"><span class="pending-body"></span><button class="remove-pending" title="Remove">×</button></div></td>';pending.querySelector('.pending-body').textContent=body;pending.querySelector('.remove-pending').addEventListener('click',()=>{pendingComments[index]=null;pending.remove();updatePendingCount();});row.after(pending);row.hidden=true;input.value='';openFormKey=null;updatePendingCount();}));document.querySelectorAll('.markdown-body a[href]').forEach((link)=>link.addEventListener('click',(event)=>{event.preventDefault();post('openExternal',{url:link.getAttribute('href')});}));const restoredTab=typeof savedState.activeTab==='string'?savedState.activeTab:'inline-reviews';const restoredButton=document.querySelector('[data-tab="'+restoredTab+'"]');if(restoredButton)showTab(restoredTab,restoredButton,false);updatePendingCount();
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
    .split(String.fromCharCode(34))
    .join("&quot;")
    .replace(/'/g, "&#39;");
}
