import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import type { RepoInfo } from "../context/repoManager";
import type { GiteaIssue, GiteaComment } from "../api/types";
import { log } from "../debug/outputChannel";

export class IssueDetailPanel {
  private static panels = new Map<string, IssueDetailPanel>();
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static async show(
    extensionUri: vscode.Uri,
    api: GiteaApiClient,
    repoInfo: RepoInfo,
    issue: GiteaIssue,
  ): Promise<void> {
    const key = `${repoInfo.key}#${issue.number}`;
    const existing = IssueDetailPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "giteaIssueDetail",
      `Issue #${issue.number}: ${issue.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new IssueDetailPanel(
      panel,
      extensionUri,
      api,
      repoInfo,
      issue,
      key,
    );
    IssueDetailPanel.panels.set(key, instance);
    await instance.update(issue);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly api: GiteaApiClient,
    private readonly repoInfo: RepoInfo,
    private issue: GiteaIssue,
    private readonly key: string,
  ) {
    this.panel = panel;
    void this.extensionUri;

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
      case "addComment":
        await this.addComment((msg.body as string) ?? "");
        break;
      case "close":
        await this.changeState("closed");
        break;
      case "reopen":
        await this.changeState("open");
        break;
      case "editIssue":
        await this.editIssue(
          (msg.title as string) ?? "",
          (msg.body as string) ?? "",
        );
        break;
      case "refresh":
        this.issue = await this.api.getIssue(this.repoInfo, this.issue.number);
        await this.update(this.issue);
        break;
      case "openInBrowser":
        await vscode.env.openExternal(vscode.Uri.parse(this.issue.html_url));
        break;
      case "openExternal":
        await this.openExternal((msg.url as string) ?? "");
        break;
      case "debug":
        log("Issue webview: " + (msg.body as string));
        break;
      default:
        log("Issue unknown message: " + msg.command);
        break;
    }
  }

  private async openExternal(rawUrl: string): Promise<void> {
    try {
      const resolved = new URL(rawUrl, this.issue.html_url);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        throw new Error("Unsupported URL scheme");
      }
      await vscode.env.openExternal(vscode.Uri.parse(resolved.toString()));
    } catch (error) {
      log(`Issue link rejected: ${rawUrl} (${(error as Error).message})`);
      vscode.window.showWarningMessage("Unsupported issue link.");
    }
  }

  private async editIssue(title: string, body: string): Promise<void> {
    if (!title.trim()) {
      vscode.window.showWarningMessage("Title cannot be empty.");
      return;
    }
    try {
      this.issue = await this.api.updateIssue(this.repoInfo, this.issue.number, {
        title: title.trim(),
        body,
      });
      this.panel.title = `Issue #${this.issue.number}: ${this.issue.title}`;
      await this.update(this.issue);
      vscode.window.showInformationMessage(
        `Issue #${this.issue.number} updated.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
    }
  }

  private async addComment(body: string): Promise<void> {
    if (!body.trim()) {
      vscode.window.showWarningMessage("Comment cannot be empty.");
      return;
    }
    try {
      await this.api.addIssueComment(this.repoInfo, this.issue.number, body);
      vscode.window.showInformationMessage("Comment posted.");
      this.issue = await this.api.getIssue(this.repoInfo, this.issue.number);
      await this.update(this.issue);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to add comment: ${(err as Error).message}`,
      );
    }
  }

  private async changeState(state: "open" | "closed"): Promise<void> {
    try {
      this.issue =
        state === "closed"
          ? await this.api.closeIssue(this.repoInfo, this.issue.number)
          : await this.api.reopenIssue(this.repoInfo, this.issue.number);
      await this.update(this.issue);
      vscode.window.showInformationMessage(
        `Issue #${this.issue.number} ${state === "closed" ? "closed" : "re-opened"}.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
    }
  }

  async update(issue: GiteaIssue): Promise<void> {
    log("Issue update: #" + issue.number);
    try {
      const comments = await this.api.listIssueComments(
        this.repoInfo,
        issue.number,
      );
      const [bodyHtml, ...commentBodies] = await Promise.all([
        this.renderMarkdown(issue.body ?? ""),
        ...comments.map((comment) => this.renderMarkdown(comment.body ?? "")),
      ]);
      this.panel.webview.html = this.renderHtml(
        issue,
        comments,
        bodyHtml,
        commentBodies,
      );
    } catch (err) {
      this.panel.webview.html = `<!DOCTYPE html><html><body><h2>Error</h2><p>${escHtml((err as Error).message)}</p></body></html>`;
    }
  }

  private async renderMarkdown(markdown: string): Promise<string> {
    if (!markdown.trim()) {
      return "";
    }
    try {
      const rendered = await vscode.commands.executeCommand<string>(
        "markdown.api.render",
        markdown,
      );
      if (typeof rendered === "string") {
        return rendered;
      }
      throw new Error("VS Code Markdown renderer returned no HTML");
    } catch (error) {
      log(`Issue Markdown renderer fallback: ${(error as Error).message}`);
      return `<pre>${escHtml(markdown)}</pre>`;
    }
  }

  private renderHtml(
    issue: GiteaIssue,
    comments: GiteaComment[],
    bodyHtml: string,
    commentBodies: string[],
  ): string {
    const stateBg = issue.state === "open" ? "#2da44e" : "#cf222e";
    const stateLabel = issue.state === "open" ? "Open" : "Closed";
    const stateIcon = issue.state === "open" ? "🟢" : "🟣";
    const nonce = getNonce();

    const labelsHtml =
      issue.labels
        ?.map(
          (label) =>
            `<span class="label" style="background:#${escHtml(label.color)}">${escHtml(label.name)}</span>`,
        )
        .join("") ?? "";
    const assigneesHtml = issue.assignees?.length
      ? `<span class="mi">👤 ${issue.assignees.map((user) => escHtml(user.login)).join(", ")}</span>`
      : issue.assignee
        ? `<span class="mi">👤 ${escHtml(issue.assignee.login)}</span>`
        : "";
    const milestoneHtml = issue.milestone
      ? `<span class="mi">🏁 ${escHtml(issue.milestone.title)}</span>`
      : "";

    const commentsHtml = comments.length
      ? comments
          .map((comment, index) => {
            const renderedBody = commentBodies[index] ?? "";
            return `<div class="comment" id="comment-${comment.id}">
              <div class="comment-hdr">
                <img src="${escHtml(comment.user.avatar_url)}" class="avatar" alt="">
                <strong>${escHtml(comment.user.login)}</strong>
                <span class="time">${escHtml(new Date(comment.created_at).toLocaleString())}</span>
              </div>
              <div class="comment-body markdown-body">${renderedBody}</div>
            </div>`;
          })
          .join("")
      : '<p class="empty">No comments yet.</p>';

    const createdDate = new Date(issue.created_at).toLocaleString();
    const updatedDate = new Date(issue.updated_at).toLocaleString();
    const closedDate = issue.closed_at
      ? new Date(issue.closed_at).toLocaleString()
      : "—";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Issue #${issue.number}</title>
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
*{box-sizing:border-box}
body{font-family:var(--vscode-font-family,-apple-system,sans-serif);font-size:13px;color:var(--fg);background:var(--bg);padding:14px 20px;margin:0}
h1{font-size:1.18em;line-height:1.4;font-weight:600}.title-row h1{margin:0}
h2{font-size:.92em;font-weight:600;margin:0 0 8px}
a{color:var(--vscode-textLink-foreground)}
code{background:var(--block-bg);padding:1px 5px;border-radius:3px;font-size:.9em;font-family:var(--mono)}
pre{background:var(--block-bg);padding:8px 12px;border-radius:4px;overflow-x:auto;margin:.6em 0}pre code{background:none;padding:0}
.badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:.72em;font-weight:700;color:#fff;text-transform:uppercase}
.label{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.72em;font-weight:600;color:#fff;margin-right:3px}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.82em;color:var(--dim);margin:4px 0 12px}
.mi,.dim,.time{color:var(--dim)}.time{margin-left:auto}
.actions{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.btn{background:var(--btn-bg);color:var(--btn-fg);border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:.87em;font-family:inherit;white-space:nowrap}
.btn:hover{background:var(--btn-hover)}.btn.sec{background:var(--btn2-bg);color:var(--btn2-fg)}.btn.sec:hover{background:var(--btn2-hover)}
.btn.danger{background:#b91c1c;color:#fff}.btn.success{background:#15803d;color:#fff}.btn.sm{font-size:.75em;padding:3px 8px}
.btn:focus-visible,.tab:focus-visible,textarea:focus-visible,input:focus-visible,a:focus-visible{outline:1px solid var(--focus);outline-offset:2px}
.tabs{display:flex;gap:1px;border-bottom:1px solid var(--border);margin:0 0 14px}
.tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);cursor:pointer;padding:7px 13px;font-size:.88em;font-family:inherit}
.tab:hover{color:var(--fg)}.tab.active{color:var(--fg);border-bottom-color:var(--focus);font-weight:600}
.tab-content{display:none}.tab-content.active{display:block}
.desc-body{line-height:1.6;background:var(--block-bg);border:1px solid var(--border);border-radius:5px;padding:12px;margin-bottom:14px;overflow:hidden;word-break:break-word}
.markdown-body p{margin:.5em 0}.markdown-body p:first-child{margin-top:0}.markdown-body p:last-child{margin-bottom:0}
.markdown-body ul,.markdown-body ol{padding-left:1.6em}.markdown-body blockquote{border-left:3px solid var(--border);padding-left:12px;margin:.6em 0;color:var(--dim)}
.markdown-body img{max-width:100%;height:auto}.markdown-body input[type="checkbox"]{width:auto;margin-right:6px}
.comment{border:1px solid var(--border);border-radius:6px;margin-bottom:10px;overflow:hidden}
.comment-hdr{display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--block-bg);border-bottom:1px solid var(--border);font-size:.84em}
.comment-body{padding:10px 12px;line-height:1.5;overflow:hidden;word-break:break-word}.avatar{width:20px;height:20px;border-radius:50%}
.empty{color:var(--dim);font-style:italic;padding:6px 0}.form-section{margin-top:14px}
textarea,input[type="text"]{width:100%;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:4px;padding:7px;font-family:inherit;font-size:.9em;box-sizing:border-box}
textarea{resize:vertical}.edit-form{background:var(--block-bg);border:1px solid var(--focus);border-radius:6px;padding:14px;margin-bottom:14px}.edit-form label{display:block;font-size:.82em;font-weight:600;margin-bottom:3px;color:var(--dim)}
.field{margin-bottom:10px}.edit-actions{display:flex;gap:8px;margin-top:10px}
.timeline{position:relative;padding-left:20px;border-left:2px solid var(--border)}.timeline-entry{position:relative;margin-bottom:14px;padding-left:16px}.timeline-entry::before{content:'';position:absolute;left:-7px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--focus);border:2px solid var(--bg)}
.tl-label{font-size:.82em;font-weight:600;color:var(--dim);text-transform:uppercase}.tl-value{font-size:.92em;margin-top:2px}
</style>
</head>
<body>
<div class="title-row" style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
  <h1 id="issue-title">${stateIcon} Issue #${issue.number}: ${escHtml(issue.title)}</h1>
  <button id="edit" class="btn sm">✏️ Edit</button>
</div>
<div class="meta-row">
  <span class="badge" style="background:${stateBg}">${stateLabel}</span>
  by <strong>${escHtml(issue.user.login)}</strong>
  <span class="dim">${escHtml(new Date(issue.created_at).toLocaleDateString())}</span>
  ${labelsHtml}${assigneesHtml}${milestoneHtml}
</div>
<div class="actions">
  <button id="open-browser" class="btn">🔗 Open in Browser</button>
  <button id="refresh" class="btn">↺ Refresh</button>
  ${issue.state === "open" ? '<button id="change-state" class="btn danger">✕ Close Issue</button>' : '<button id="change-state" class="btn success">↺ Re-open Issue</button>'}
</div>
<div id="edit-form" class="edit-form" hidden>
  <div class="field"><label for="edit-title">Title</label><input type="text" id="edit-title" value="${escHtml(issue.title)}"></div>
  <div class="field"><label for="edit-body">Body</label><textarea id="edit-body" style="height:120px">${escHtml(issue.body || "")}</textarea></div>
  <div class="edit-actions"><button id="save-edit" class="btn">Save</button><button id="cancel-edit" class="btn sec">Cancel</button></div>
</div>
<div class="tabs" role="tablist" aria-label="Issue detail sections">
  <button id="details-tab" class="tab active" role="tab" aria-selected="true" data-tab="details">Details</button>
  <button id="history-tab" class="tab" role="tab" aria-selected="false" data-tab="history">📜 History</button>
</div>
<div id="tab-details" class="tab-content active" role="tabpanel" aria-labelledby="details-tab">
  ${bodyHtml ? `<div class="desc-body markdown-body">${bodyHtml}</div>` : '<div class="desc-body dim"><em>(no description)</em></div>'}
  <div style="margin-top:14px">
    <h2>Comments (${comments.length})</h2>
    <div id="comments-list">${commentsHtml}</div>
    <div class="form-section">
      <label for="commentBody" class="dim">Add a comment</label>
      <textarea id="commentBody" style="height:60px" placeholder="Write a comment..."></textarea>
      <div style="margin-top:8px"><button id="post-comment" class="btn">Post Comment</button></div>
    </div>
  </div>
</div>
<div id="tab-history" class="tab-content" role="tabpanel" aria-labelledby="history-tab">
  <div class="timeline">
    <div class="timeline-entry"><div class="tl-label">Created</div><div class="tl-value">${escHtml(createdDate)}</div></div>
    <div class="timeline-entry"><div class="tl-label">Last Updated</div><div class="tl-value">${escHtml(updatedDate)}</div></div>
    <div class="timeline-entry"><div class="tl-label">Closed</div><div class="tl-value">${escHtml(closedDate)}</div></div>
  </div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
function post(command, extra) {
  vscode.postMessage(Object.assign({ command }, extra || {}));
}
function showTab(name, button) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.remove('active');
    el.setAttribute('aria-selected', 'false');
  });
  document.getElementById('tab-' + name)?.classList.add('active');
  button.classList.add('active');
  button.setAttribute('aria-selected', 'true');
}
document.getElementById('edit')?.addEventListener('click', () => {
  document.getElementById('edit-form').hidden = false;
  document.getElementById('edit-title')?.focus();
});
document.getElementById('cancel-edit')?.addEventListener('click', () => {
  document.getElementById('edit-form').hidden = true;
});
document.getElementById('save-edit')?.addEventListener('click', () => {
  const title = document.getElementById('edit-title').value;
  const body = document.getElementById('edit-body').value;
  post('editIssue', { title, body });
});
document.getElementById('open-browser')?.addEventListener('click', () => post('openInBrowser'));
document.getElementById('refresh')?.addEventListener('click', () => post('refresh'));
document.getElementById('change-state')?.addEventListener('click', () => post('${issue.state === "open" ? "close" : "reopen"}'));
document.getElementById('post-comment')?.addEventListener('click', () => {
  const input = document.getElementById('commentBody');
  const body = (input.value || '').trim();
  if (!body) return;
  post('addComment', { body });
  input.value = '';
});
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab, button)));
document.querySelectorAll('.markdown-body a[href]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  post('openExternal', { url: link.getAttribute('href') });
}));
</script>
</body>
</html>`;
  }

  private dispose(): void {
    IssueDetailPanel.panels.delete(this.key);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return value;
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
