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
    const stateLabel = issue.state === "open" ? "Open" : "Closed";
    const stateClass = issue.state === "open" ? "state-open" : "state-closed";
    const nonce = getNonce();

    const labelsHtml =
      issue.labels
        ?.map(
          (label) =>
            `<span class="label" style="--label-color:#${escHtml(label.color)}">${escHtml(label.name)}</span>`,
        )
        .join("") ?? "";
    const assigneesHtml = issue.assignees?.length
      ? `<span class="mi">Assignees: ${issue.assignees.map((user) => escHtml(user.login)).join(", ")}</span>`
      : issue.assignee
        ? `<span class="mi">Assignee: ${escHtml(issue.assignee.login)}</span>`
        : "";
    const milestoneHtml = issue.milestone
      ? `<span class="mi">Milestone: ${escHtml(issue.milestone.title)}</span>`
      : "";

    const commentsHtml = comments.length
      ? comments
          .map((comment, index) => {
            const renderedBody = commentBodies[index] ?? "";
            return `<article class="comment" id="comment-${comment.id}">
              <header class="comment-hdr">
                <img src="${escHtml(comment.user.avatar_url)}" class="avatar" alt="">
                <strong>${escHtml(comment.user.login)}</strong>
                <span class="time">${escHtml(new Date(comment.created_at).toLocaleString())}</span>
              </header>
              <div class="comment-body markdown-body">${renderedBody}</div>
            </article>`;
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
  --surface: var(--vscode-editor-background);
  --surface-subtle: var(--vscode-textBlockQuote-background, var(--vscode-editor-inactiveSelectionBackground));
  --fg: var(--vscode-foreground);
  --muted: var(--vscode-descriptionForeground);
  --border: var(--vscode-panel-border, var(--vscode-widget-border));
  --focus: var(--vscode-focusBorder);
  --link: var(--vscode-textLink-foreground);
  --link-active: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
  --input-bg: var(--vscode-input-background);
  --input-fg: var(--vscode-input-foreground);
  --input-border: var(--vscode-input-border, transparent);
  --button-bg: var(--vscode-button-background);
  --button-fg: var(--vscode-button-foreground);
  --button-hover: var(--vscode-button-hoverBackground);
  --button-secondary-bg: var(--vscode-button-secondaryBackground);
  --button-secondary-fg: var(--vscode-button-secondaryForeground);
  --button-secondary-hover: var(--vscode-button-secondaryHoverBackground);
  --success: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
  --danger: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
  --mono: var(--vscode-editor-font-family);
  --base-size: var(--vscode-font-size, 13px);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--surface);color:var(--fg)}
body{font-family:var(--vscode-font-family);font-size:var(--base-size);line-height:1.45;padding:16px 20px}
button,input,textarea{font:inherit}
a{color:var(--link);text-decoration:none}a:hover{color:var(--link-active);text-decoration:underline}
.title-row{display:flex;align-items:center;gap:10px;margin-bottom:5px;min-width:0}
.title-row h1{font-size:1.22em;line-height:1.3;font-weight:600;margin:0;min-width:0;overflow-wrap:anywhere}
.state-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:currentColor}.state-open{color:var(--success)}.state-closed{color:var(--danger)}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 9px;color:var(--muted);font-size:.92em;margin:0 0 12px}
.meta-row strong{color:var(--fg);font-weight:600}
.badge{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.78em;font-weight:600;text-transform:uppercase;background:transparent}
.label{display:inline-flex;align-items:center;border:1px solid var(--label-color);color:var(--fg);border-radius:999px;padding:1px 7px;font-size:.78em;font-weight:500;background:color-mix(in srgb,var(--label-color) 18%,transparent)}
.mi,.dim,.time{color:var(--muted)}.time{margin-left:auto;font-size:.92em}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.btn{border:1px solid transparent;border-radius:2px;padding:4px 10px;min-height:26px;cursor:pointer;background:var(--button-bg);color:var(--button-fg)}
.btn:hover{background:var(--button-hover)}.btn.sec{background:var(--button-secondary-bg);color:var(--button-secondary-fg)}.btn.sec:hover{background:var(--button-secondary-hover)}
.btn.danger{background:var(--button-secondary-bg);color:var(--danger);border-color:color-mix(in srgb,var(--danger) 55%,transparent)}.btn.danger:hover{background:color-mix(in srgb,var(--danger) 14%,var(--button-secondary-bg))}
.btn.success{background:var(--button-secondary-bg);color:var(--success);border-color:color-mix(in srgb,var(--success) 55%,transparent)}.btn.success:hover{background:color-mix(in srgb,var(--success) 14%,var(--button-secondary-bg))}
.btn.sm{font-size:.9em;padding:2px 8px;min-height:22px}
.btn:focus-visible,.tab:focus-visible,textarea:focus-visible,input:focus-visible,a:focus-visible{outline:1px solid var(--focus);outline-offset:2px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin:0 0 14px}
.tab{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--muted);cursor:pointer;padding:6px 10px;font:inherit}.tab:hover{color:var(--fg)}.tab.active{color:var(--fg);border-bottom-color:var(--focus);font-weight:600}
.tab-content{display:none}.tab-content.active{display:block}
section>h2{font-size:1em;line-height:1.3;font-weight:600;margin:16px 0 8px;color:var(--fg)}
.desc-body{background:var(--surface-subtle);border:1px solid var(--border);border-radius:3px;padding:12px 14px;margin-bottom:14px;overflow:hidden;overflow-wrap:anywhere}
.markdown-body{font-size:1em;line-height:1.5}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{font-weight:600;line-height:1.3;margin:1.05em 0 .45em;color:var(--fg)}
.markdown-body h1:first-child,.markdown-body h2:first-child,.markdown-body h3:first-child{margin-top:0}
.markdown-body h1{font-size:1.28em;border-bottom:1px solid var(--border);padding-bottom:.25em}.markdown-body h2{font-size:1.16em}.markdown-body h3{font-size:1.06em}.markdown-body h4,.markdown-body h5,.markdown-body h6{font-size:1em}
.markdown-body p{margin:.55em 0}.markdown-body p:first-child{margin-top:0}.markdown-body p:last-child{margin-bottom:0}
.markdown-body ul,.markdown-body ol{margin:.55em 0;padding-left:1.65em}.markdown-body li{margin:.22em 0}.markdown-body li>p{margin:.2em 0}
.markdown-body blockquote{border-left:3px solid var(--vscode-textBlockQuote-border,var(--border));background:var(--vscode-textBlockQuote-background,transparent);padding:.25em .8em;margin:.7em 0;color:var(--muted)}
.markdown-body code{font-family:var(--mono);font-size:.92em;background:var(--vscode-textCodeBlock-background,var(--surface-subtle));border-radius:2px;padding:.08em .3em}
.markdown-body pre{font-family:var(--mono);font-size:.92em;line-height:1.45;background:var(--vscode-textCodeBlock-background,var(--surface-subtle));border:1px solid var(--border);padding:9px 11px;border-radius:3px;overflow:auto;margin:.7em 0}.markdown-body pre code{background:transparent;padding:0}
.markdown-body hr{border:0;border-top:1px solid var(--border);margin:1em 0}.markdown-body img{max-width:100%;height:auto}
.markdown-body table{border-collapse:collapse;width:max-content;max-width:100%;display:block;overflow:auto;margin:.7em 0}.markdown-body th,.markdown-body td{border:1px solid var(--border);padding:5px 8px;text-align:left}.markdown-body th{font-weight:600;background:var(--surface-subtle)}
.markdown-body input[type="checkbox"]{width:auto;margin:0 6px 0 0;vertical-align:middle;accent-color:var(--success)}
.comment{border:1px solid var(--border);border-radius:3px;margin-bottom:10px;overflow:hidden;background:var(--surface)}
.comment-hdr{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-subtle);border-bottom:1px solid var(--border)}.comment-hdr strong{font-weight:600}
.comment-body{padding:10px 12px;overflow:hidden;overflow-wrap:anywhere}.avatar{width:20px;height:20px;border-radius:50%}
.empty{color:var(--muted);font-style:italic;padding:6px 0}.form-section{margin-top:14px}.form-section>label{display:block;margin-bottom:5px;font-size:.92em}
textarea,input[type="text"]{width:100%;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:2px;padding:6px 8px;box-sizing:border-box}
textarea{resize:vertical;line-height:1.45}.edit-form{background:var(--surface-subtle);border:1px solid var(--focus);border-radius:3px;padding:12px;margin-bottom:14px}.edit-form label{display:block;font-size:.92em;font-weight:600;margin-bottom:4px;color:var(--fg)}
.field{margin-bottom:10px}.edit-actions{display:flex;gap:6px;margin-top:10px}
.timeline{position:relative;padding-left:18px;border-left:1px solid var(--border)}.timeline-entry{position:relative;margin-bottom:13px;padding-left:13px}.timeline-entry::before{content:'';position:absolute;left:-18px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--focus);box-shadow:0 0 0 2px var(--surface)}
.tl-label{font-size:.82em;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}.tl-value{margin-top:2px}
@media (max-width:600px){body{padding:12px}.title-row{align-items:flex-start;flex-wrap:wrap}.time{margin-left:0;width:100%}}
</style>
</head>
<body>
<div class="title-row">
  <span class="state-dot ${stateClass}" aria-hidden="true"></span>
  <h1 id="issue-title">Issue #${issue.number}: ${escHtml(issue.title)}</h1>
  <button id="edit" class="btn sm">Edit</button>
</div>
<div class="meta-row">
  <span class="badge ${stateClass}">${stateLabel}</span>
  by <strong>${escHtml(issue.user.login)}</strong>
  <span>${escHtml(new Date(issue.created_at).toLocaleDateString())}</span>
  ${labelsHtml}${assigneesHtml}${milestoneHtml}
</div>
<div class="actions">
  <button id="open-browser" class="btn">Open in Browser</button>
  <button id="refresh" class="btn sec">Refresh</button>
  ${issue.state === "open" ? '<button id="change-state" class="btn danger">Close Issue</button>' : '<button id="change-state" class="btn success">Re-open Issue</button>'}
</div>
<div id="edit-form" class="edit-form" hidden>
  <div class="field"><label for="edit-title">Title</label><input type="text" id="edit-title" value="${escHtml(issue.title)}"></div>
  <div class="field"><label for="edit-body">Body</label><textarea id="edit-body" style="height:120px">${escHtml(issue.body || "")}</textarea></div>
  <div class="edit-actions"><button id="save-edit" class="btn">Save</button><button id="cancel-edit" class="btn sec">Cancel</button></div>
</div>
<div class="tabs" role="tablist" aria-label="Issue detail sections">
  <button id="details-tab" class="tab active" role="tab" aria-selected="true" data-tab="details">Details</button>
  <button id="history-tab" class="tab" role="tab" aria-selected="false" data-tab="history">History</button>
</div>
<div id="tab-details" class="tab-content active" role="tabpanel" aria-labelledby="details-tab">
  ${bodyHtml ? `<div class="desc-body markdown-body">${bodyHtml}</div>` : '<div class="desc-body dim"><em>(no description)</em></div>'}
  <section>
    <h2>Comments (${comments.length})</h2>
    <div id="comments-list">${commentsHtml}</div>
    <div class="form-section">
      <label for="commentBody" class="dim">Add a comment</label>
      <textarea id="commentBody" style="height:60px" placeholder="Write a comment..."></textarea>
      <div style="margin-top:8px"><button id="post-comment" class="btn">Post Comment</button></div>
    </div>
  </section>
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
