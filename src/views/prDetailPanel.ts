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

// ── Raw diff parser ──────────────────────────────────────────────────────────

/** Parse a unified diff string into a map of filename → patch string */
function parseRawDiff(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const fileBlocks = raw.split(/^diff --git /m).slice(1);
  for (const block of fileBlocks) {
    const firstLine = block.split("\n")[0];
    const mB = firstLine.match(/ b\/(.+)$/);
    if (!mB) {
      continue;
    }
    const filename = mB[1].trim();
    const hunkIdx = block.indexOf("\n@@");
    const patch = hunkIdx >= 0 ? block.slice(hunkIdx + 1) : "";
    map.set(filename, patch);
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
  if (!patch?.trim()) {
    return [];
  }
  const result: DiffLine[] = [];
  let oldLine = 0,
    newLine = 0,
    pos = 0;
  for (const raw of patch.split("\n")) {
    pos++;
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1]) - 1;
        newLine = parseInt(m[2]) - 1;
      }
      result.push({ type: "hunk", content: raw, pos });
    } else if (raw.startsWith("+")) {
      newLine++;
      result.push({ type: "add", content: raw.slice(1), newLine, pos });
    } else if (raw.startsWith("-")) {
      oldLine++;
      result.push({ type: "del", content: raw.slice(1), oldLine, pos });
    } else if (raw.startsWith("\\")) {
      result.push({ type: "meta", content: raw, pos });
    } else if (raw !== "") {
      oldLine++;
      newLine++;
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

// ── Panel class ──────────────────────────────────────────────────────────────

export class PRDetailPanel {
  private static panels = new Map<number, PRDetailPanel>();
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private markedScriptUri: string = "";

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
    // Compute marked script URI
    try {
      const markedPath = vscode.Uri.joinPath(
        extensionUri,
        "node_modules/marked/lib/marked.umd.js",
      );
      this.markedScriptUri = panel.webview.asWebviewUri(markedPath).toString();
    } catch {
      this.markedScriptUri = "";
    }

    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private async handleMessage(msg: {
    command: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (msg.command) {
      case "submitReview":
        await this.submitReviewWithComments(
          msg.event as "APPROVED" | "REQUEST_CHANGES" | "COMMENT",
          (msg.body as string) ?? "",
          (msg.comments as Array<{
            path: string;
            new_position: number;
            old_position: number;
            body: string;
          }>) ?? [],
        );
        break;
      case "addComment":
        await this.addPRComment((msg.body as string) ?? "");
        break;
      case "merge":
        await this.merge(
          (msg.method as "merge" | "rebase" | "squash") ?? "merge",
        );
        break;
      case "closePR":
        await this.setPRState("closed");
        break;
      case "reopenPR":
        await this.setPRState("open");
        break;
      case "editPR":
        await this.editPR(
          (msg.title as string) ?? "",
          (msg.body as string) ?? "",
          msg.base as string | undefined,
        );
        break;
      case "refresh":
        this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
        await this.update(this.pr);
        break;
      case "openInBrowser":
        vscode.env.openExternal(vscode.Uri.parse(this.pr.html_url));
        break;
      case "checkout":
        await vscode.commands.executeCommand(
          "gitea.checkoutPR",
          this.pr,
          this.repoInfo,
        );
        break;
    }
  }

  private async editPR(
    title: string,
    body: string,
    base?: string,
  ): Promise<void> {
    if (!title.trim()) {
      vscode.window.showWarningMessage("Title cannot be empty.");
      return;
    }
    const params: { title?: string; body?: string; base?: string } = {
      title: title.trim(),
      body,
    };
    if (base && base !== this.pr.base.ref) {
      params.base = base;
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
        `PR #${this.pr.number} updated.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
    }
  }

  private async setPRState(state: "open" | "closed"): Promise<void> {
    try {
      if (state === "closed") {
        const ok = await vscode.window.showWarningMessage(
          `Close PR #${this.pr.number}?`,
          { modal: true },
          "Confirm",
        );
        if (ok !== "Confirm") {
          return;
        }
        this.pr = await this.api.closePullRequest(
          this.repoInfo,
          this.pr.number,
        );
      } else {
        this.pr = await this.api.reopenPullRequest(
          this.repoInfo,
          this.pr.number,
        );
      }
      this.panel.title = `PR #${this.pr.number}: ${this.pr.title}`;
      await this.update(this.pr);
      vscode.window.showInformationMessage(
        `PR #${this.pr.number} ${state === "closed" ? "closed" : "re-opened"}.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
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
      this.panel.webview.postMessage({
        command: "reviewSubmitted",
      });
      const label =
        event === "APPROVED"
          ? "Approved"
          : event === "REQUEST_CHANGES"
            ? "Changes Requested"
            : "Commented";
      vscode.window.showInformationMessage(
        `Review submitted: ${label}${comments.length ? ` with ${comments.length} inline comment(s)` : ""}`,
      );
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to submit review: ${(err as Error).message}`,
      );
    }
  }

  private async addPRComment(body: string): Promise<void> {
    if (!body.trim()) {
      return;
    }
    try {
      await this.api.addPRComment(this.repoInfo, this.pr.number, body);
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
    }
  }

  private async merge(method: "merge" | "rebase" | "squash"): Promise<void> {
    const ok = await vscode.window.showWarningMessage(
      `Merge PR #${this.pr.number} using "${method}"?`,
      { modal: true },
      "Confirm",
    );
    if (ok !== "Confirm") {
      return;
    }
    try {
      await this.api.mergePullRequest(this.repoInfo, this.pr.number, method);
      vscode.window.showInformationMessage(`PR #${this.pr.number} merged.`);
      this.pr = await this.api.getPullRequest(this.repoInfo, this.pr.number);
      await this.update(this.pr);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to merge: ${(err as Error).message}`,
      );
    }
  }

  async update(pr: GiteaPullRequest): Promise<void> {
    this.panel.webview.postMessage({ command: "loading" });
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
      const enrichedFiles = files.map((f) => ({
        ...f,
        patch: patchMap.get(f.filename) ?? f.patch ?? "",
      }));

      this.panel.webview.html = this.renderHtml(
        pr,
        comments,
        reviews,
        enrichedFiles,
        commits,
        reviewComments,
        branches,
      );
    } catch (err) {
      this.panel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;color:var(--vscode-foreground,#ccc);background:var(--vscode-editor-background,#1e1e1e)"><h2>Error loading PR</h2><p>${escHtml((err as Error).message)}</p></body></html>`;
    }
  }

  private buildDiffRows(
    patch: string,
    fi: number,
    filename: string,
    reviewComments: GiteaReviewComment[],
  ): string {
    const lines = parsePatch(patch);
    if (lines.length === 0) {
      return `<tr><td colspan="3" class="empty-diff">No diff available (binary file or content unchanged)</td></tr>`;
    }

    const rcMap = new Map<string, GiteaReviewComment[]>();
    for (const c of reviewComments.filter((r) => r.path === filename)) {
      const key = `${c.new_position ?? 0}:${c.old_position ?? 0}`;
      rcMap.set(key, [...(rcMap.get(key) ?? []), c]);
    }

    let rows = "";
    for (const ln of lines) {
      const rowCls =
        ln.type === "add"
          ? "diff-add"
          : ln.type === "del"
            ? "diff-del"
            : ln.type === "hunk"
              ? "diff-hunk"
              : "diff-ctx";
      const isClickable =
        ln.type === "add" || ln.type === "del" || ln.type === "ctx";
      const oldNum = ln.oldLine != null ? String(ln.oldLine) : "";
      const newNum = ln.newLine != null ? String(ln.newLine) : "";
      const prefix =
        ln.type === "add"
          ? "+"
          : ln.type === "del"
            ? "-"
            : ln.type === "hunk"
              ? ""
              : "\u00a0";
      const displayContent =
        ln.type === "hunk"
          ? escHtml(ln.content)
          : escHtml(prefix) + escHtml(ln.content);
      const lineKey = `cf-${fi}-${ln.pos}`;

      if (isClickable) {
        const data = `data-fi="${fi}" data-pos="${ln.pos}" data-path="${escHtml(filename)}" data-nl="${ln.newLine ?? 0}" data-ol="${ln.oldLine ?? 0}"`;
        rows +=
          `<tr class="${rowCls} clickable-line" onclick="clickLine(this)" title="Click to add inline comment" ${data}>` +
          `<td class="ln ln-add-btn"><span class="add-line-btn">+</span>${oldNum}</td>` +
          `<td class="ln">${newNum}</td>` +
          `<td class="lc"><pre>${displayContent}</pre></td></tr>`;
        rows +=
          `<tr class="cf-row" id="${lineKey}" data-path="${escHtml(filename)}" data-nl="${ln.newLine ?? 0}" data-ol="${ln.oldLine ?? 0}" style="display:none">` +
          `<td colspan="3"><div class="cf-inner">` +
          `<textarea class="cf-ta" placeholder="Leave a review comment on this line..."></textarea>` +
          `<div class="cf-acts"><button class="btn" onclick="addInlineComment(this)">Add Review Comment</button>` +
          `<button class="btn sec" onclick="cancelLine(this)">Cancel</button></div>` +
          `</div></td></tr>`;
      } else {
        rows +=
          `<tr class="${rowCls}">` +
          `<td class="ln">${oldNum}</td><td class="ln">${newNum}</td>` +
          `<td class="lc"><pre>${displayContent}</pre></td></tr>`;
      }

      const rcKey = `${ln.newLine ?? 0}:${ln.oldLine ?? 0}`;
      for (const c of rcMap.get(rcKey) ?? []) {
        rows +=
          `<tr class="rc-row"><td colspan="3"><div class="rc">` +
          `<div class="rc-hdr"><strong>${escHtml(c.user.login)}</strong>` +
          `<span class="dim ml8">${new Date(c.created_at).toLocaleString()}</span></div>` +
          `<div class="rc-body">${escHtml(c.body)}</div></div></td></tr>`;
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
  ): string {
    const isOpen = pr.state === "open" && !pr.merged;
    const stateBg = pr.merged ? "#6f42c1" : isOpen ? "#2da44e" : "#cf222e";
    const stateLabel = pr.merged ? "Merged" : isOpen ? "Open" : "Closed";

    const labelsHtml = pr.labels?.length
      ? pr.labels
          .map(
            (l) =>
              `<span class="label" style="background:#${l.color}">${escHtml(l.name)}</span>`,
          )
          .join(" ")
      : "";
    const assigneesHtml = pr.assignees?.length
      ? `<span class="mi">👤 ${pr.assignees.map((a) => escHtml(a.login)).join(", ")}</span>`
      : pr.assignee
        ? `<span class="mi">👤 ${escHtml(pr.assignee.login)}</span>`
        : "";
    const milestoneHtml = pr.milestone
      ? `<span class="mi">🏁 ${escHtml(pr.milestone.title)}</span>`
      : "";

    const branchOptions = branches
      .map(
        (b) =>
          `<option value="${escHtml(b)}"${b === pr.base.ref ? " selected" : ""}>${escHtml(b)}</option>`,
      )
      .join("");

    const stColors: Record<string, string> = {
      added: "#2da44e",
      deleted: "#cf222e",
      modified: "#d97706",
      renamed: "#0969da",
      changed: "#d97706",
    };

    const filesHtml = files
      .map((f, fi) => {
        const stColor = stColors[f.status] ?? "#888";
        const diffRows = this.buildDiffRows(
          f.patch,
          fi,
          f.filename,
          reviewComments,
        );
        const fileLabel = f.filename.split("/").pop() ?? f.filename;
        const fileDir = f.filename.includes("/")
          ? f.filename.slice(0, f.filename.lastIndexOf("/") + 1)
          : "";
        return (
          `<div class="file-block" id="fb-${fi}">` +
          `<div class="file-header" onclick="toggleFile(${fi}, event)">` +
          `<input type="checkbox" class="viewed-cb" id="vc-${fi}" title="Mark as viewed"` +
          ` onchange="markViewed(${fi},this.checked)" onclick="event.stopPropagation()">` +
          `<span class="fsb" style="background:${stColor}">${f.status[0].toUpperCase()}</span>` +
          `<span class="file-path"><span class="file-dir">${escHtml(fileDir)}</span><span class="file-name">${escHtml(fileLabel)}</span></span>` +
          `<span class="fst ml-auto"><span class="add-s">+${f.additions}</span>&nbsp;<span class="del-s">-${f.deletions}</span></span>` +
          `<span class="viewed-badge">Viewed ✓</span>` +
          `<span class="toggle-icon" id="ti-${fi}">▶</span>` +
          `</div>` +
          `<div class="fdw" id="fd-${fi}" style="display:none">` +
          `<table class="diff-table"><tbody>${diffRows}</tbody></table></div></div>`
        );
      })
      .join("");

    const reviewsHtml =
      reviews.length === 0
        ? '<p class="empty">No reviews yet.</p>'
        : reviews
            .filter((r) => !r.stale)
            .map(
              (r) =>
                `<div class="review review-${r.state.toLowerCase()}">` +
                `<div class="review-hdr"><strong>${escHtml(r.user.login)}</strong>&nbsp;` +
                `<span class="badge badge-${r.state.toLowerCase()}">${escHtml(r.state.replace("_", " "))}</span>` +
                `<span class="dim ml8">${new Date(r.submitted_at).toLocaleString()}</span></div>` +
                (r.body?.trim()
                  ? `<div class="review-body" data-raw="${escAttr(r.body)}"></div>`
                  : "") +
                `</div>`,
            )
            .join("");

    const commitsHtml =
      commits.length === 0
        ? '<p class="empty">No commits.</p>'
        : commits
            .map(
              (c) =>
                `<div class="commit-entry">` +
                `<code class="sha">${escHtml(c.sha.slice(0, 8))}</code>` +
                `<span class="commit-msg">${escHtml(c.commit.message.split("\n")[0])}</span>` +
                `<span class="dim">${escHtml(c.commit.author.name)}</span></div>`,
            )
            .join("");

    const commentsJson = JSON.stringify(comments).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const bodyJson = JSON.stringify(pr.body || "").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const titleJson = JSON.stringify(pr.title).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const baseJson = JSON.stringify(pr.base.ref).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const headJson = JSON.stringify(pr.head.ref).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const branchOptsJson = JSON.stringify(branchOptions).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const filesJson = JSON.stringify(files.map(f => ({ filename: f.filename, patch: f.patch, status: f.status, additions: f.additions, deletions: f.deletions }))).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const reviewCommentsJson = JSON.stringify(reviewComments).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const isOpenJson = JSON.stringify(isOpen);

    const markedScriptTag = this.markedScriptUri
      ? `<script src="${this.markedScriptUri}"></script>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: vscode-resource:; style-src 'unsafe-inline'; script-src 'unsafe-inline' vscode-resource:;">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR #${pr.number}</title>
<style>
:root {
  --bg: var(--vscode-editor-background,#1e1e1e);
  --fg: var(--vscode-editor-foreground,#d4d4d4);
  --border: var(--vscode-panel-border,#3c3c3c);
  --dim: var(--vscode-descriptionForeground,#888);
  --input-bg: var(--vscode-input-background,#3c3c3c);
  --input-fg: var(--vscode-input-foreground,#d4d4d4);
  --input-border: var(--vscode-input-border,#555);
  --btn-bg: var(--vscode-button-background,#0e639c);
  --btn-fg: var(--vscode-button-foreground,#fff);
  --btn-hover: var(--vscode-button-hoverBackground,#1177bb);
  --btn2-bg: var(--vscode-button-secondaryBackground,#3a3d41);
  --btn2-fg: var(--vscode-button-secondaryForeground,#ccc);
  --btn2-hover: var(--vscode-button-secondaryHoverBackground,#45494e);
  --focus: var(--vscode-focusBorder,#007fd4);
  --block-bg: var(--vscode-textBlockQuote-background,#252526);
  --mono: var(--vscode-editor-font-family,'Menlo','Consolas','Courier New',monospace);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,-apple-system,sans-serif);font-size:13px;color:var(--fg);background:var(--bg);padding:14px 20px}
h1{font-size:1.18em;margin-bottom:6px;line-height:1.4;font-weight:600}
h2{font-size:.92em;font-weight:600;margin-bottom:8px}
code{background:var(--block-bg);padding:1px 5px;border-radius:3px;font-size:.85em;font-family:var(--mono)}
.badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:.72em;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.02em}
.badge-approved{background:#2da44e}.badge-request_changes{background:#cf222e}
.badge-comment,.badge-commented{background:#0969da}
.label{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.72em;font-weight:600;color:#fff;margin-right:3px}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.82em;color:var(--dim);margin-bottom:12px}
.mi{color:var(--dim)}.dim{color:var(--dim)}.ml8{margin-left:8px}.ml-auto{margin-left:auto}
.branch-row{display:flex;align-items:center;gap:7px;margin-bottom:12px;font-size:.87em}
.branch-tag{background:var(--block-bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:var(--mono);font-size:.85em}
.stats-row{display:flex;flex-wrap:wrap;gap:18px;padding:8px 14px;background:var(--block-bg);border:1px solid var(--border);border-radius:5px;margin-bottom:12px}
.stat{display:flex;flex-direction:column;gap:2px}
.stat-lbl{color:var(--dim);font-size:.75em;text-transform:uppercase;letter-spacing:.04em}
.stat-val{font-weight:700;font-size:1.05em}
.actions{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.btn{background:var(--btn-bg);color:var(--btn-fg);border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:.87em;font-family:inherit;white-space:nowrap}
.btn:hover{background:var(--btn-hover)}
.btn.sec{background:var(--btn2-bg);color:var(--btn2-fg)}.btn.sec:hover{background:var(--btn2-hover)}
.btn.danger{background:#b91c1c;color:#fff}.btn.danger:hover{background:#dc2626}
.btn.success{background:#15803d;color:#fff}.btn.success:hover{background:#16a34a}
.btn.sm{font-size:.75em;padding:3px 8px}
.tabs{display:flex;gap:1px;border-bottom:1px solid var(--border);margin:0 0 14px}
.tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);cursor:pointer;padding:7px 13px;font-size:.88em;font-family:inherit}
.tab:hover{color:var(--fg)}.tab.active{color:var(--fg);border-bottom-color:var(--focus);font-weight:600}
.tab-content{display:none}.tab-content.active{display:block}
.comment{border:1px solid var(--border);border-radius:6px;margin-bottom:10px;overflow:hidden}
.comment-hdr{display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--block-bg);border-bottom:1px solid var(--border);font-size:.84em}
.comment-body{padding:10px 12px;line-height:1.5;overflow:hidden;word-break:break-word}
.comment-body p{margin:0 0 0.5em}.comment-body p:last-child{margin:0}
.comment-body code{background:var(--block-bg);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em}
.comment-body pre{background:var(--block-bg);padding:8px 12px;border-radius:4px;overflow-x:auto;margin:0.5em 0}
.comment-body pre code{background:none;padding:0}
.comment-body ul,.comment-body ol{padding-left:1.5em;margin:0.5em 0}
.comment-body blockquote{border-left:3px solid var(--border);padding-left:12px;margin:0.5em 0;color:var(--dim)}
.comment-body a{color:var(--focus)}
.comment-body img{max-width:100%;height:auto}
.avatar{width:20px;height:20px;border-radius:50%}
.time{margin-left:auto;color:var(--dim)}
.review{border-left:3px solid var(--border);padding:8px 12px;margin-bottom:8px;border-radius:0 4px 4px 0;background:var(--block-bg)}
.review-hdr{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.review-body{line-height:1.5;font-size:.88em;margin-top:6px;overflow:hidden;word-break:break-word}
.review-body p{margin:0 0 0.5em}.review-body p:last-child{margin:0}
.review-body code{background:var(--block-bg);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em}
.review-body pre{background:var(--block-bg);padding:8px 12px;border-radius:4px;overflow-x:auto;margin:0.5em 0}
.review-body pre code{background:none;padding:0}
.review-body ul,.review-body ol{padding-left:1.5em;margin:0.5em 0}
.review-body blockquote{border-left:3px solid var(--border);padding-left:12px;margin:0.5em 0;color:var(--dim)}
.review-approved{border-left-color:#2da44e}
.review-request_changes{border-left-color:#cf222e}
.review-comment,.review-commented{border-left-color:#0969da}
.commit-entry{display:flex;align-items:center;gap:9px;padding:5px 0;border-bottom:1px solid var(--border);font-size:.87em}
.commit-entry:last-child{border-bottom:none}
.sha{background:var(--block-bg);padding:1px 6px;border-radius:3px;font-size:.8em;font-family:var(--mono);flex-shrink:0}
.commit-msg{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:var(--dim);font-style:italic;padding:6px 0}
.form-section{margin-top:14px}
textarea{width:100%;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:4px;padding:7px;font-family:inherit;font-size:.9em;resize:vertical}
textarea:focus{outline:1px solid var(--focus)}
select{background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);padding:5px 10px;border-radius:4px;font-family:inherit;font-size:.87em}
input[type="text"]{width:100%;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:4px;padding:6px 8px;font-family:inherit;font-size:.9em;box-sizing:border-box}
input[type="text"]:focus{outline:1px solid var(--focus)}
.desc-body{line-height:1.6;background:var(--block-bg);border:1px solid var(--border);border-radius:5px;padding:12px;margin-bottom:14px;overflow:hidden;word-break:break-word}
.desc-body p{margin:0 0 0.5em}.desc-body p:last-child{margin:0}
.desc-body code{background:var(--block-bg);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:.85em}
.desc-body pre{background:rgba(0,0,0,0.2);padding:8px 12px;border-radius:4px;overflow-x:auto;margin:0.5em 0}
.desc-body pre code{background:none;padding:0}
.desc-body ul,.desc-body ol{padding-left:1.5em;margin:0.5em 0}
.desc-body blockquote{border-left:3px solid var(--border);padding-left:12px;margin:0.5em 0;color:var(--dim)}
.desc-body a{color:var(--focus)}
.desc-body img{max-width:100%;height:auto}
.md-toggle-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.md-toggle-row .dim{font-size:.8em}

/* ── edit form ── */
.edit-form{background:var(--block-bg);border:1px solid var(--focus);border-radius:6px;padding:14px;margin-bottom:14px}
.edit-form label{display:block;font-size:.82em;font-weight:600;margin-bottom:3px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
.edit-form .field{margin-bottom:10px}
.edit-form .field:last-of-type{margin-bottom:0}
.edit-actions{display:flex;gap:8px;margin-top:10px}

/* ── review panel ── */
.review-submit-bar{background:var(--block-bg);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:14px}
.rsb-title{font-weight:600;font-size:.93em;margin-bottom:8px;display:flex;align-items:center;gap:10px}
#pc-count{color:var(--focus);font-size:.82em}
.rsb-acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.files-summary{font-size:.82em;color:var(--dim);margin-bottom:10px}

/* ── diff file blocks ── */
.file-block{border:1px solid var(--border);border-radius:6px;margin-bottom:6px;overflow:hidden;transition:opacity .2s}
.file-block.viewed{opacity:.45}
.file-header{display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--block-bg);cursor:pointer;user-select:none;font-size:.86em;gap:8px}
.file-header:hover{background:color-mix(in srgb,var(--block-bg) 85%,var(--fg) 15%)}
.viewed-cb{flex-shrink:0;cursor:pointer;accent-color:var(--focus)}
.fsb{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;font-size:.68em;font-weight:700;color:#fff;flex-shrink:0}
.file-path{flex:1;overflow:hidden;display:flex;align-items:baseline;gap:0;min-width:0}
.file-dir{color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:.82em;flex-shrink:1;min-width:0}
.file-name{font-family:var(--mono);font-size:.85em;font-weight:500;white-space:nowrap;flex-shrink:0}
.fst{flex-shrink:0;font-size:.8em}
.add-s{color:#2da44e;font-weight:600}.del-s{color:#cf222e;font-weight:600}
.viewed-badge{font-size:.7em;color:#2da44e;border:1px solid #2da44e;padding:1px 5px;border-radius:8px;display:none;flex-shrink:0;white-space:nowrap}
.file-block.viewed .viewed-badge{display:inline-block}
.toggle-icon{color:var(--dim);font-size:.78em;flex-shrink:0;transition:transform .15s}
.fdw{overflow-x:auto;border-top:1px solid var(--border);background:var(--bg)}

/* ── diff table ── */
.diff-table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;line-height:1.45;table-layout:fixed}
.diff-table col.col-old{width:44px}.diff-table col.col-new{width:44px}.diff-table col.col-code{width:auto}
td.ln{width:44px;text-align:right;padding:0 6px;color:var(--dim);background:var(--block-bg);border-right:1px solid var(--border);user-select:none;font-size:11px;vertical-align:top;white-space:nowrap}
td.ln-add-btn{position:relative}
.add-line-btn{display:none;position:absolute;left:2px;top:50%;transform:translateY(-50%);background:var(--focus);color:#fff;border:none;border-radius:2px;font-size:9px;width:12px;height:12px;line-height:1;cursor:pointer;align-items:center;justify-content:center;font-family:inherit;font-weight:700;padding:0}
.clickable-line:hover .add-line-btn{display:flex}
td.lc{padding:0 8px;white-space:pre;overflow:hidden;word-break:break-all;vertical-align:top}
td.lc pre{margin:0;padding:0;font-family:inherit;font-size:inherit;white-space:pre;tab-size:4;word-break:normal}
.diff-add td.lc{background:rgba(46,160,67,.13)}
.diff-add td.ln{background:rgba(46,160,67,.07)}
.diff-del td.lc{background:rgba(248,81,73,.13)}
.diff-del td.ln{background:rgba(248,81,73,.07)}
.diff-hunk td{background:rgba(9,105,218,.09);color:#7db3e8}
.diff-hunk td.lc pre{font-style:italic;font-size:11px}
.clickable-line{cursor:pointer}
.clickable-line:hover td.lc{background-color:rgba(255,255,255,.04)}
.empty-diff{padding:10px 14px;color:var(--dim);font-style:italic;font-size:.87em}

/* ── inline comment form ── */
.cf-row td{padding:0;background:var(--bg)}
.cf-inner{padding:10px 14px;border-top:1px solid var(--border);background:linear-gradient(135deg,rgba(0,127,212,.04),transparent)}
.cf-ta{height:75px;margin-bottom:8px}
.cf-acts{display:flex;gap:8px}

/* ── existing review comments ── */
.rc-row td{padding:0}
.rc{padding:9px 14px;border-top:1px dashed var(--border);border-left:3px solid var(--focus);background:rgba(0,127,212,.05)}
.rc-hdr{display:flex;align-items:center;margin-bottom:4px;font-size:.84em}
.rc-body{white-space:pre-wrap;font-size:.87em;line-height:1.5}

/* ── pending comment cards ── */
.pc-row td{padding:0}
.pc{padding:8px 14px;border-top:1px dashed var(--border);border-left:3px dashed #d97706;background:rgba(217,119,6,.05);display:flex;align-items:flex-start;gap:8px}
.pc-tag{font-size:.68em;background:#d97706;color:#fff;padding:1px 6px;border-radius:8px;flex-shrink:0;margin-top:1px;white-space:nowrap}
.pc-body{flex:1;font-size:.85em;white-space:pre-wrap;line-height:1.4}
.pc-rm{background:none;border:none;color:var(--dim);cursor:pointer;font-size:.85em;flex-shrink:0;padding:0 2px}
.pc-rm:hover{color:var(--fg)}
</style>
</head>
<body>

<div class="title-row" style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
  <h1 id="pr-title">#${pr.number}: ${escHtml(pr.title)}</h1>
  <button class="btn sm" onclick="startEdit()">✏️ Edit</button>
</div>

<div class="meta-row">
  <span class="badge" style="background:${stateBg}">${stateLabel}</span>
  by <strong>${escHtml(pr.user.login)}</strong>
  <span class="dim">${new Date(pr.created_at).toLocaleDateString()}</span>
  ${labelsHtml}${assigneesHtml}${milestoneHtml}
</div>

<div class="actions">
  <button class="btn" onclick="post('openInBrowser')">🔗 Open in Browser</button>
  <button class="btn" onclick="post('checkout')">⎇ Checkout</button>
  <button class="btn" onclick="post('refresh')">↺ Refresh</button>
  ${
    isOpen
      ? `<select id="mergeMethod"><option value="merge">Merge commit</option><option value="rebase">Rebase</option><option value="squash">Squash</option></select>
  <button class="btn success" onclick="post('merge',{method:document.getElementById('mergeMethod').value})">↑ Merge PR</button>
  <button class="btn danger" onclick="post('closePR')">✕ Close PR</button>`
      : ""
  }
  ${pr.state === "closed" && !pr.merged ? `<button class="btn success" onclick="post('reopenPR')">↺ Re-open</button>` : ""}
</div>

<div class="tabs">
  <button class="tab active" onclick="showTab('details',this)">Details</button>
  <button class="tab" onclick="showTab('reviews',this)">🔍 Reviews (${reviews.length})</button>
  <button class="tab" onclick="showTab('comments',this)">💬 Comments (${comments.length})</button>
  <button class="tab" onclick="showTab('commits',this)">📦 Commits (${commits.length})</button>
</div>

<div id="tab-details" class="tab-content active">
  <div id="view-mode">
    ${
      pr.body?.trim()
        ? `<div class="md-toggle-row">
          <button class="btn sec sm" id="body-toggle" onclick="toggleMd('body')">Raw</button>
          <span class="dim">Description</span>
        </div>
        <div id="body-content" class="desc-body" data-raw="${escAttr(pr.body)}"></div>`
        : `<div class="desc-body" style="color:var(--dim);font-style:italic">(no description)</div>`
    }
    <div class="branch-row" style="margin-top:10px">
      <span class="dim">Base:</span>
      <span class="branch-tag">${escHtml(pr.base.ref)}</span>
      <span class="dim">←</span>
      <span class="branch-tag">${escHtml(pr.head.ref)}</span>
    </div>
    ${
      pr.commits != null || pr.additions != null
        ? `<div class="stats-row">
  ${pr.commits != null ? `<div class="stat"><span class="stat-lbl">Commits</span><span class="stat-val">${pr.commits}</span></div>` : ""}
  ${pr.additions != null ? `<div class="stat"><span class="stat-lbl">Additions</span><span class="stat-val" style="color:#2da44e">+${pr.additions}</span></div>` : ""}
  ${pr.deletions != null ? `<div class="stat"><span class="stat-lbl">Deletions</span><span class="stat-val" style="color:#cf222e">-${pr.deletions}</span></div>` : ""}
  ${pr.changed_files != null ? `<div class="stat"><span class="stat-lbl">Files</span><span class="stat-val">${pr.changed_files}</span></div>` : ""}
</div>`
        : ""
    }
  </div>
  <div id="edit-form" class="edit-form" style="display:none">
    <div class="field">
      <label>Title</label>
      <input type="text" id="edit-title" value="${escHtml(pr.title)}">
    </div>
    <div class="field">
      <label>Body</label>
      <textarea id="edit-body" style="height:120px">${escHtml(pr.body || "")}</textarea>
    </div>
    <div class="field">
      <label>Base Branch</label>
      <select id="edit-base">${branchOptions}</select>
    </div>
    <div class="edit-actions">
      <button class="btn" onclick="saveEdit()">Save</button>
      <button class="btn sec" onclick="cancelEdit()">Cancel</button>
    </div>
  </div>
</div>

<div id="tab-reviews" class="tab-content">
  <div class="review-submit-bar">
    <div class="rsb-title">Submit Review <span id="pc-count"></span></div>
    <textarea id="rv-body" style="height:60px" placeholder="Overall review comment (optional)..."></textarea>
    <div class="rsb-acts">
      ${
        isOpen
          ? `<button class="btn success" onclick="submitReview('APPROVED')">✅ Approve</button>
      <button class="btn danger" onclick="submitReview('REQUEST_CHANGES')">⚠️ Request Changes</button>`
          : ""
      }
      <button class="btn" onclick="submitReview('COMMENT')">💬 Comment</button>
    </div>
  </div>
  <div class="files-summary">${files.length} file(s) changed &nbsp;·&nbsp; Click any diff line to add an inline comment</div>
  ${filesHtml}
  <h2 style="margin-top:16px">Submitted Reviews</h2>
  ${reviewsHtml}
</div>

<div id="tab-comments" class="tab-content">
  <div id="comments-list"></div>
  <div class="form-section">
    <h2>Add a comment</h2>
    <textarea id="commentBody" style="height:80px" placeholder="Write a comment..."></textarea>
    <div style="margin-top:8px"><button class="btn" onclick="submitComment()">Post Comment</button></div>
  </div>
</div>

<div id="tab-commits" class="tab-content">${commitsHtml}</div>

${markedScriptTag}
<script>
const vscode = acquireVsCodeApi();
const bodyText = ${bodyJson};
const commentsData = ${commentsJson};
let pendingComments = [];
let openFormKey = null;
let mdMode = { body: 'rendered' };

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMd(text) {
  if (typeof marked !== 'undefined') return marked.parse(text);
  return esc(text);
}

function post(cmd, extra) {
  vscode.postMessage(Object.assign({ command: cmd }, extra || {}));
}

function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

function toggleMd(id) {
  mdMode[id] = mdMode[id] === 'rendered' ? 'raw' : 'rendered';
  if (id === 'body') {
    renderBody();
  } else {
    renderComments();
  }
}

function renderBody() {
  var el = document.getElementById('body-content');
  var btn = document.getElementById('body-toggle');
  if (!el) return;
  if (mdMode.body === 'rendered') {
    el.innerHTML = renderMd(bodyText);
    if (btn) btn.textContent = 'Raw';
  } else {
    el.innerHTML = '<pre style="margin:0;white-space:pre-wrap">' + esc(bodyText) + '</pre>';
    if (btn) btn.textContent = 'Rendered';
  }
}

function renderComments() {
  var container = document.getElementById('comments-list');
  if (!container) return;
  if (commentsData.length === 0) {
    container.innerHTML = '<p class="empty">No comments yet.</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < commentsData.length; i++) {
    var c = commentsData[i];
    var cid = 'comment-' + c.id;
    var mode = mdMode[cid] || 'rendered';
    var bodyHtml;
    if (mode === 'rendered') {
      bodyHtml = renderMd(c.body);
    } else {
      bodyHtml = '<pre style="margin:0;white-space:pre-wrap">' + esc(c.body) + '</pre>';
    }
    var toggleText = mode === 'rendered' ? 'Raw' : 'Rendered';
    html += '<div class="comment" id="' + cid + '">' +
      '<div class="comment-hdr">' +
      '<img src="' + esc(c.user.avatar_url) + '" class="avatar" alt="">' +
      '<strong>' + esc(c.user.login) + '</strong>' +
      '<span class="time">' + new Date(c.created_at).toLocaleString() + '</span>' +
      '<button class="btn sec sm" onclick="toggleMd(\'' + cid + '\')">' + toggleText + '</button>' +
      '</div>' +
      '<div class="comment-body">' + bodyHtml + '</div>' +
      '</div>';
  }
  container.innerHTML = html;
}

function startEdit() {
  document.getElementById('view-mode').style.display = 'none';
  document.getElementById('edit-form').style.display = 'block';
}

function cancelEdit() {
  document.getElementById('view-mode').style.display = 'block';
  document.getElementById('edit-form').style.display = 'none';
}

function saveEdit() {
  var title = document.getElementById('edit-title').value;
  var body = document.getElementById('edit-body').value;
  var base = document.getElementById('edit-base').value;
  post('editPR', { title: title, body: body, base: base });
}

function submitComment() {
  var el = document.getElementById('commentBody');
  var body = (el.value || '').trim();
  if (!body) return;
  post('addComment', { body: body });
  el.value = '';
}

function toggleFile(fi, e) {
  if (e && e.target && (e.target.type === 'checkbox')) return;
  var w = document.getElementById('fd-' + fi);
  var ic = document.getElementById('ti-' + fi);
  var nowHidden = w.style.display === 'none';
  w.style.display = nowHidden ? '' : 'none';
  ic.textContent = nowHidden ? '▼' : '▶';
}

function markViewed(fi, checked) {
  document.getElementById('fb-' + fi).classList.toggle('viewed', checked);
  if (checked) {
    var w = document.getElementById('fd-' + fi);
    var ic = document.getElementById('ti-' + fi);
    if (w) { w.style.display = 'none'; }
    if (ic) { ic.textContent = '▶'; }
  }
}

function clickLine(tr) {
  var key = tr.dataset.fi + '-' + tr.dataset.pos;
  var form = document.getElementById('cf-' + key);
  if (!form) return;
  if (openFormKey && openFormKey !== key) {
    var prev = document.getElementById('cf-' + openFormKey);
    if (prev) prev.style.display = 'none';
  }
  var show = form.style.display === 'none';
  form.style.display = show ? 'table-row' : 'none';
  openFormKey = show ? key : null;
  if (show) { setTimeout(function() { var ta = form.querySelector('textarea'); if (ta) ta.focus(); }, 40); }
}

function cancelLine(btn) {
  btn.closest('tr').style.display = 'none';
  openFormKey = null;
}

function addInlineComment(btn) {
  var row = btn.closest('tr.cf-row');
  var ta = row.querySelector('textarea');
  var body = (ta.value || '').trim();
  if (!body) return;
  var path = row.dataset.path;
  var newPos = parseInt(row.dataset.nl || '0');
  var oldPos = parseInt(row.dataset.ol || '0');
  var idx = pendingComments.length;
  pendingComments.push({ path: path, new_position: newPos, old_position: oldPos, body: body });
  var pcHtml = '<tr class="pc-row"><td colspan="3"><div class="pc">' +
    '<span class="pc-tag">Pending</span>' +
    '<span class="pc-body">' + esc(body) + '</span>' +
    '<button class="pc-rm" title="Remove" onclick="removeComment(' + idx + ',this)">✕</button>' +
    '</div></td></tr>';
  row.insertAdjacentHTML('afterend', pcHtml);
  row.style.display = 'none';
  ta.value = '';
  openFormKey = null;
  updatePCCount();
}

function removeComment(idx, btn) {
  pendingComments[idx] = null;
  btn.closest('tr').remove();
  updatePCCount();
}

function updatePCCount() {
  var n = pendingComments.filter(Boolean).length;
  var el = document.getElementById('pc-count');
  if (el) el.textContent = n > 0 ? '(' + n + ' pending inline comment' + (n !== 1 ? 's' : '') + ')' : '';
}

function submitReview(event) {
  var body = (document.getElementById('rv-body').value || '');
  var comments = pendingComments.filter(Boolean);
  post('submitReview', { event: event, body: body, comments: comments });
}

function renderReviews() {
  document.querySelectorAll('.review-body').forEach(function(el) {
    var raw = el.getAttribute('data-raw');
    if (raw) el.innerHTML = renderMd(raw);
  });
}

window.addEventListener("message", function(event) {
  var message = event.data;
  if (!message || !message.command) return;
  if (message.command === "loading") {
    document.body.style.opacity = "0.7";
  } else if (message.command === "reviewSubmitted") {
    pendingComments.length = 0;
    document.querySelectorAll(".pc-row").forEach(function(row) { row.remove(); });
    var reviewBody = document.getElementById("rv-body");
    if (reviewBody) reviewBody.value = "";
    updatePCCount();
  }
});

renderBody();
renderComments();
renderReviews();
</script>
</body>
</html>`;
  }

  dispose(): void {
    PRDetailPanel.panels.delete(this.pr.number);
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}