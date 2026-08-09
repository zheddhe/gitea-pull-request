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
        vscode.env.openExternal(vscode.Uri.parse(this.issue.html_url));
        break;
      case "debug":
        log("Issue webview: " + (msg.body as string));
        break;
      default:
        log("Issue unknown message: " + msg.command);
        break;
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
      this.panel.webview.html = this.renderHtml(issue, comments);
    } catch (err) {
      this.panel.webview.html = `<!DOCTYPE html><html><body><h2>Error</h2><p>${escHtml((err as Error).message)}</p></body></html>`;
    }
  }

  private renderHtml(issue: GiteaIssue, comments: GiteaComment[]): string {
    const stateBg = issue.state === "open" ? "#2da44e" : "#cf222e";
    const stateLabel = issue.state === "open" ? "Open" : "Closed";
    const stateIcon = issue.state === "open" ? "🟢" : "🟣";

    const labelsHtml =
      issue.labels
        ?.map(
          (l) =>
            `<span class="label" style="background:#${l.color}">${escHtml(l.name)}</span>`,
        )
        .join("") ?? "";
    const assigneesHtml =
      issue.assignees?.length
        ? `<span class="mi">👤 ${issue.assignees.map((a) => escHtml(a.login)).join(", ")}</span>`
        : issue.assignee
          ? `<span class="mi">👤 ${escHtml(issue.assignee.login)}</span>`
          : "";
    const milestoneHtml = issue.milestone
      ? `<span class="mi">🏁 ${escHtml(issue.milestone.title)}</span>`
      : "";

    const createdDate = new Date(issue.created_at).toLocaleString();
    const updatedDate = new Date(issue.updated_at).toLocaleString();
    const closedDate = issue.closed_at
      ? new Date(issue.closed_at).toLocaleString()
      : "—";

    const commentsJson = JSON.stringify(comments).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const bodyJson = JSON.stringify(issue.body || "").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const titleJson = JSON.stringify(issue.title).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: vscode-resource:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
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
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,-apple-system,sans-serif);font-size:13px;color:var(--fg);background:var(--bg);padding:14px 20px}
h1{font-size:1.18em;margin-bottom:6px;line-height:1.4;font-weight:600}
h2{font-size:.92em;font-weight:600;margin-bottom:8px}
code{background:var(--block-bg);padding:1px 5px;border-radius:3px;font-size:.85em;font-family:var(--mono)}
.badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:.72em;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.02em}
.label{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.72em;font-weight:600;color:#fff;margin-right:3px}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.82em;color:var(--dim);margin-bottom:12px}
.mi{color:var(--dim)}.dim{color:var(--dim)}.ml8{margin-left:8px}.ml-auto{margin-left:auto}
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
.empty{color:var(--dim);font-style:italic;padding:6px 0}
.form-section{margin-top:14px}
textarea{width:100%;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:4px;padding:7px;font-family:inherit;font-size:.9em;resize:vertical}
textarea:focus{outline:1px solid var(--focus)}
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

/* ── timeline ── */
.timeline{position:relative;padding-left:20px;border-left:2px solid var(--border)}
.timeline-entry{position:relative;margin-bottom:14px;padding-left:16px}
.timeline-entry:last-child{margin-bottom:0}
.timeline-entry::before{content:'';position:absolute;left:-7px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--focus);border:2px solid var(--bg)}
.timeline-entry .tl-label{font-size:.82em;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
.timeline-entry .tl-value{font-size:.92em;margin-top:2px}
</style>
</head>
<body>

<div class="title-row" style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
  <h1 id="issue-title">${stateIcon} Issue #${issue.number}: ${escHtml(issue.title)}</h1>
  <button class="btn sm" onclick="startEdit()">✏️ Edit</button>
</div>

<div class="meta-row">
  <span class="badge" style="background:${stateBg}">${stateLabel}</span>
  by <strong>${escHtml(issue.user.login)}</strong>
  <span class="dim">${new Date(issue.created_at).toLocaleDateString()}</span>
  ${labelsHtml}${assigneesHtml}${milestoneHtml}
</div>

<div class="actions">
  <button class="btn" onclick="post('openInBrowser')">🔗 Open in Browser</button>
  <button class="btn" onclick="post('refresh')">↺ Refresh</button>
  ${
    issue.state === "open"
      ? `<button class="btn danger" onclick="post('close')">✕ Close Issue</button>`
      : `<button class="btn success" onclick="post('reopen')">↺ Re-open Issue</button>`
  }
</div>

<div id="edit-form" class="edit-form" style="display:none">
  <div class="field">
    <label>Title</label>
    <input type="text" id="edit-title" value="${escHtml(issue.title)}">
  </div>
  <div class="field">
    <label>Body</label>
    <textarea id="edit-body" style="height:120px">${escHtml(issue.body || "")}</textarea>
  </div>
  <div class="edit-actions">
    <button class="btn" onclick="saveEdit()">Save</button>
    <button class="btn sec" onclick="cancelEdit()">Cancel</button>
  </div>
</div>

<div class="tabs">
  <button class="tab active" onclick="showTab('details',this)">Details</button>
  <button class="tab" onclick="showTab('history',this)">📜 History</button>
</div>

<div id="tab-details" class="tab-content active">
  ${
    issue.body?.trim()
      ? `<div id="body-content" class="desc-body"></div>`
      : `<div class="desc-body" style="color:var(--dim);font-style:italic">(no description)</div>`
  }
  <div style="margin-top:10px">
    ${labelsHtml ? `<div style="margin-bottom:6px">${labelsHtml}</div>` : ""}
    ${assigneesHtml ? `<div class="mi" style="margin-bottom:6px">${assigneesHtml}</div>` : ""}
    ${milestoneHtml ? `<div class="mi">${milestoneHtml}</div>` : ""}
  </div>
  <div style="margin-top:14px">
    <h2>Comments (${comments.length})</h2>
    <div id="comments-list"></div>
    <div class="form-section">
      <textarea id="commentBody" style="height:60px" placeholder="Write a comment..."></textarea>
      <div style="margin-top:8px"><button class="btn" onclick="submitComment()">Post Comment</button></div>
    </div>
  </div>
</div>

<div id="tab-history" class="tab-content">
  <div class="timeline">
    <div class="timeline-entry">
      <div class="tl-label">Created</div>
      <div class="tl-value">${escHtml(createdDate)}</div>
    </div>
    <div class="timeline-entry">
      <div class="tl-label">Last Updated</div>
      <div class="tl-value">${escHtml(updatedDate)}</div>
    </div>
    <div class="timeline-entry">
      <div class="tl-label">Closed</div>
      <div class="tl-value">${escHtml(closedDate)}</div>
    </div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
function debugLog(msg) { vscode.postMessage({ command: 'debug', body: msg }); }
window.onerror = function(msg, url, line, col, err) {
  try {
    var e = err ? (err.stack || err.message) : msg + ' line ' + line;
    debugLog('ERROR: ' + e);
  } catch(x) {}
  return false;
};
debugLog('Issue webview loaded - step1');
const bodyText = ${bodyJson};
const commentsData = ${commentsJson};
debugLog('Issue webview loaded - step2');

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function post(cmd, extra) {
  debugLog('post: ' + cmd + (extra ? ' with extra' : ''));
  vscode.postMessage(Object.assign({ command: cmd }, extra || {}));
}

function showTab(name, btn) {
  debugLog('showTab: ' + name);
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

function renderBody() {
  try {
    var el = document.getElementById('body-content');
    if (!el) { debugLog('renderBody: no body-content element'); return; }
    el.innerHTML = '<pre style="margin:0;white-space:pre-wrap">' + esc(bodyText) + '</pre>';
    debugLog('renderBody done, body length=' + (bodyText ? bodyText.length : 0));
  } catch(e) { debugLog('renderBody error: ' + e.message); }
}

function renderComments() {
  try {
    var container = document.getElementById('comments-list');
    if (!container) { debugLog('renderComments: no comments-list element'); return; }
    if (commentsData.length === 0) {
      container.innerHTML = '<p class="empty">No comments yet.</p>';
      debugLog('renderComments: no comments');
      return;
    }
    var html = '';
    for (var i = 0; i < commentsData.length; i++) {
      var c = commentsData[i];
      html += '<div class="comment" id="comment-' + c.id + '">' +
        '<div class="comment-hdr">' +
        '<img src="' + esc(c.user.avatar_url) + '" class="avatar" alt="">' +
        '<strong>' + esc(c.user.login) + '</strong>' +
        '<span class="time">' + new Date(c.created_at).toLocaleString() + '</span>' +
        '</div>' +
        '<div class="comment-body"><pre style="margin:0;white-space:pre-wrap">' + esc(c.body) + '</pre></div>' +
        '</div>';
    }
    container.innerHTML = html;
    debugLog('renderComments done, count=' + commentsData.length);
  } catch(e) { debugLog('renderComments error: ' + e.message); }
}

function startEdit() {
  document.getElementById('edit-form').style.display = 'block';
}

function cancelEdit() {
  document.getElementById('edit-form').style.display = 'none';
}

function saveEdit() {
  var title = document.getElementById('edit-title').value;
  var body = document.getElementById('edit-body').value;
  post('editIssue', { title: title, body: body });
}

function submitComment() {
  var el = document.getElementById('commentBody');
  var body = (el.value || '').trim();
  if (!body) return;
  post('addComment', { body: body });
  el.value = '';
}

window.addEventListener("message", function(event) {
  var message = event.data;
  debugLog('message received: ' + (message ? message.command : 'null'));
  if (!message || !message.command) return;
  if (message.command === "loading") {
    document.body.style.opacity = "0.7";
  }
});

renderBody();
renderComments();
</script>
</body>
</html>`;
  }

  private dispose(): void {
    IssueDetailPanel.panels.delete(this.key);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}