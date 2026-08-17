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
      await existing.update(issue);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "giteaIssueDetail",
      `Issue #${issue.number}: ${issue.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new IssueDetailPanel(panel, extensionUri, api, repoInfo, issue, key);
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
      (message) => void this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  private async handleMessage(message: {
    command: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (message.command) {
      case "addComment":
        await this.addComment((message.body as string) ?? "");
        return;
      case "editComment":
        await this.editComment(
          Number(message.commentId),
          (message.body as string) ?? "",
        );
        return;
      case "editTitle":
        await this.updateIssue({ title: ((message.title as string) ?? "").trim() });
        return;
      case "editBody":
        await this.updateIssue({ body: (message.body as string) ?? "" });
        return;
      case "refresh":
        this.issue = await this.api.getIssue(this.repoInfo, this.issue.number);
        await this.update(this.issue);
        return;
      case "openInBrowser":
        await vscode.env.openExternal(vscode.Uri.parse(this.issue.html_url));
        return;
      case "openExternal":
        await this.openExternal((message.url as string) ?? "");
        return;
      default:
        log(`Issue unknown message: ${message.command}`);
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

  private async updateIssue(params: { title?: string; body?: string }): Promise<void> {
    if (params.title !== undefined && !params.title.trim()) {
      vscode.window.showWarningMessage("Title cannot be empty.");
      return;
    }
    try {
      this.issue = await this.api.updateIssue(this.repoInfo, this.issue.number, params);
      this.panel.title = `Issue #${this.issue.number}: ${this.issue.title}`;
      await this.update(this.issue);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update issue: ${(error as Error).message}`);
    }
  }

  private async addComment(body: string): Promise<void> {
    if (!body.trim()) return;
    try {
      await this.api.addIssueComment(this.repoInfo, this.issue.number, body.trim());
      this.issue = await this.api.getIssue(this.repoInfo, this.issue.number);
      await this.update(this.issue);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to add comment: ${(error as Error).message}`);
    }
  }

  private async editComment(commentId: number, body: string): Promise<void> {
    if (!Number.isFinite(commentId) || commentId <= 0 || !body.trim()) return;
    try {
      await this.api.updateComment(this.repoInfo, commentId, body.trim());
      await this.update(this.issue);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to edit comment: ${(error as Error).message}`);
    }
  }

  async update(issue: GiteaIssue): Promise<void> {
    log(`Issue update: #${issue.number}`);
    try {
      const comments = await this.api.listIssueComments(this.repoInfo, issue.number);
      const rendered = await Promise.all([
        this.renderMarkdown(issue.body ?? ""),
        ...comments.map((comment) => this.renderMarkdown(comment.body ?? "")),
      ]);
      this.panel.webview.html = this.renderHtml(issue, comments, rendered[0] ?? "", rendered.slice(1));
    } catch (error) {
      this.panel.webview.html = `<!DOCTYPE html><html><body style="padding:20px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)"><h2>Error loading issue</h2><p>${escHtml((error as Error).message)}</p></body></html>`;
    }
  }

  private async renderMarkdown(markdown: string): Promise<string> {
    if (!markdown.trim()) return "";
    try {
      const rendered = await vscode.commands.executeCommand<string>("markdown.api.render", markdown);
      if (typeof rendered === "string") return rendered;
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
    const labelsHtml = issue.labels?.map(
      (label) => `<span class="label" style="--label-color:#${escHtml(label.color)}">${escHtml(label.name)}</span>`,
    ).join("") ?? "";
    const assignees = issue.assignees?.length
      ? issue.assignees.map((user) => user.login).join(", ")
      : issue.assignee?.login;
    const assigneesHtml = assignees
      ? `<span>assigned to <strong>${escHtml(assignees)}</strong></span>`
      : "";
    const milestoneHtml = issue.milestone
      ? `<span>Milestone: <strong>${escHtml(issue.milestone.title)}</strong></span>`
      : "";

    const editIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M11.3 1.7a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8.6 8.6-3.2.7.7-3.2 8.1-9.1zm.7 1.1-7.9 8.8-.3 1.1 1.1-.3 8.3-8.3L12 2.8z"/></svg>`;
    const refreshIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.2 3.8A6 6 0 1 0 14 9h-1.2a4.8 4.8 0 1 1-.7-4.3L10 6h5V1l-1.8 2.8z"/></svg>`;
    const externalIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9 2h5v5h-1V3.7L7.35 9.35l-.7-.7L12.3 3H9V2zM3 4h4v1H4v7h7V8h1v5H3V4z"/></svg>`;

    const commentsHtml = comments.length
      ? comments.map((comment, index) =>
          `<article class="comment" data-comment-id="${comment.id}"><header class="comment-header"><img src="${escHtml(comment.user.avatar_url)}" class="avatar" alt=""><strong>${escHtml(comment.user.login)}</strong><span class="time">${escHtml(new Date(comment.created_at).toLocaleString())}</span><button class="icon-btn edit-comment" data-comment-id="${comment.id}" title="Edit comment" aria-label="Edit comment by ${escHtml(comment.user.login)}">${editIcon}</button></header><div id="comment-view-${comment.id}" class="comment-body markdown-body">${commentBodies[index] ?? ""}</div><div id="comment-editor-${comment.id}" class="comment-editor" hidden><textarea id="comment-input-${comment.id}">${escHtml(comment.body ?? "")}</textarea><div class="editor-actions"><button class="btn save-comment" data-comment-id="${comment.id}">Save</button><button class="btn sec cancel-comment" data-comment-id="${comment.id}">Cancel</button></div></div></article>`,
        ).join("")
      : '<p class="empty">No comments yet.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Issue #${issue.number}</title>
<style>
:root{--surface:var(--vscode-editor-background);--subtle:var(--vscode-textBlockQuote-background,var(--vscode-editor-inactiveSelectionBackground));--fg:var(--vscode-foreground);--muted:var(--vscode-descriptionForeground);--border:var(--vscode-panel-border,var(--vscode-widget-border));--focus:var(--vscode-focusBorder);--input-bg:var(--vscode-input-background);--input-fg:var(--vscode-input-foreground);--input-border:var(--vscode-input-border,transparent);--button-bg:var(--vscode-button-background);--button-fg:var(--vscode-button-foreground);--button-secondary-bg:var(--vscode-button-secondaryBackground);--button-secondary-fg:var(--vscode-button-secondaryForeground);--success:var(--vscode-testing-iconPassed,var(--vscode-charts-green));--danger:var(--vscode-testing-iconFailed,var(--vscode-errorForeground));--mono:var(--vscode-editor-font-family)}
*{box-sizing:border-box}html,body{margin:0;background:var(--surface);color:var(--fg)}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);line-height:1.45;padding:16px 20px}button,input,textarea{font:inherit}
.title-row{display:flex;align-items:center;gap:7px;min-width:0;margin-bottom:5px;white-space:nowrap}.title-prefix,.title-text{font-size:1.22em;font-weight:600}.title-prefix{flex:0 0 auto}.title-text{overflow:hidden;text-overflow:ellipsis}.title-input{display:none;min-width:180px;width:min(520px,45vw);font-size:1.22em;font-weight:600;padding:1px 5px}.title-row.editing .title-text{display:none}.title-row.editing .title-input{display:inline-block}.state-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:currentColor}.state-open{color:var(--success)}.state-closed{color:var(--danger)}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:2px;border:0;border-radius:3px;background:transparent;color:var(--muted);cursor:pointer}.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground,var(--subtle));color:var(--fg)}.icon-btn svg{width:14px;height:14px}.meta-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;color:var(--muted);font-size:.92em;margin-bottom:14px}.meta-row strong{color:var(--fg)}.badge{display:inline-flex;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.82em;font-weight:600;text-transform:uppercase}.label{border:1px solid var(--label-color);border-radius:999px;padding:1px 7px;font-size:.78em}
.section-card,.comment{border:1px solid var(--border);border-radius:3px;margin-bottom:10px;overflow:hidden}.section-card{margin-bottom:14px}.section-bar,.comment-header{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--subtle);border-bottom:1px solid var(--border)}.section-bar{justify-content:space-between;font-weight:600}.section-content,.comment-body{padding:10px 12px}.description-editor,.comment-editor{padding:10px 12px;background:var(--subtle)}.description-editor textarea{min-height:140px}.comment-editor textarea{min-height:90px}.editor-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.btn{border:1px solid transparent;border-radius:2px;padding:4px 10px;min-height:26px;cursor:pointer;background:var(--button-bg);color:var(--button-fg)}.btn.sec{background:var(--button-secondary-bg);color:var(--button-secondary-fg)}.btn:focus-visible,.icon-btn:focus-visible,input:focus-visible,textarea:focus-visible{outline:1px solid var(--focus);outline-offset:2px}textarea,input[type="text"]{background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);border-radius:2px;padding:6px 8px;width:100%;resize:vertical}
.markdown-body{line-height:1.5;overflow-wrap:anywhere}.markdown-body h1{font-size:1.28em}.markdown-body h2{font-size:1.16em}.markdown-body h3{font-size:1.06em}.markdown-body code{font-family:var(--mono)}.markdown-body pre{overflow:auto}.markdown-body table{border-collapse:collapse;max-width:100%;overflow:auto;display:block}.markdown-body th,.markdown-body td{border:1px solid var(--border);padding:4px 7px}.markdown-body blockquote{border-left:3px solid var(--vscode-textBlockQuote-border,var(--border));padding:.25em .8em;margin:.7em 0;color:var(--muted)}
.avatar{width:20px;height:20px;border-radius:50%}.time{margin-left:auto;color:var(--muted);font-size:.92em}.empty{color:var(--muted)}.comments-title{display:flex;align-items:center;padding:7px 10px;background:var(--subtle);border:1px solid var(--border);border-radius:3px 3px 0 0;font-weight:600;margin-top:14px}
</style>
</head>
<body>
<header>
  <div id="title-row" class="title-row">
    <span class="state-dot ${stateClass}" aria-hidden="true"></span>
    <span class="title-prefix">Issue #${issue.number}</span>
    <span id="title-text" class="title-text">${escHtml(issue.title)}</span>
    <input id="title-input" class="title-input" type="text" aria-label="Issue title" value="${escHtml(issue.title)}">
    <button id="edit-title" class="icon-btn" title="Edit title" aria-label="Edit issue title">${editIcon}</button>
    <button id="open-browser" class="icon-btn" title="Open in Browser" aria-label="Open issue in browser">${externalIcon}</button>
    <button id="refresh" class="icon-btn" title="Refresh issue" aria-label="Refresh issue">${refreshIcon}</button>
  </div>
  <div class="meta-row"><span class="badge ${stateClass}">${stateLabel}</span><span>by <strong>${escHtml(issue.user.login)}</strong></span><span>${escHtml(new Date(issue.created_at).toLocaleDateString())}</span>${labelsHtml}${assigneesHtml}${milestoneHtml}</div>
</header>
<section class="section-card"><div class="section-bar"><span>Description</span><button id="edit-body" class="icon-btn" title="Edit description" aria-label="Edit issue description">${editIcon}</button></div><div id="body-view" class="section-content">${bodyHtml ? `<div class="markdown-body">${bodyHtml}</div>` : '<div class="empty">(no description)</div>'}</div><div id="body-editor" class="description-editor" hidden><textarea id="body-input">${escHtml(issue.body || "")}</textarea><div class="editor-actions"><button id="save-body" class="btn">Save</button><button id="cancel-body" class="btn sec">Cancel</button></div></div></section>
<div class="comments-title">Comments (${comments.length})</div><div>${commentsHtml}</div>
<div><textarea id="comment-body" aria-label="Add a comment" style="height:70px" placeholder="Write a comment..."></textarea><div class="editor-actions"><button id="post-comment" class="btn">Post Comment</button></div></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let titleCancelled=false;const originalTitle=${JSON.stringify(issue.title)};
function post(command,extra){vscode.postMessage(Object.assign({command},extra||{}));}
function setTitleEditing(editing){document.getElementById('title-row').classList.toggle('editing',editing);if(editing){titleCancelled=false;const input=document.getElementById('title-input');input.focus();input.select();}}
function saveTitle(){if(titleCancelled)return;const input=document.getElementById('title-input');const title=(input.value||'').trim();if(!title){input.value=originalTitle;setTitleEditing(false);return;}if(title===originalTitle){setTitleEditing(false);return;}post('editTitle',{title});}
function setBodyEditing(editing){document.getElementById('body-view').hidden=editing;document.getElementById('body-editor').hidden=!editing;if(editing)document.getElementById('body-input')?.focus();}
function setCommentEditing(id,editing){const view=document.getElementById('comment-view-'+id);const editor=document.getElementById('comment-editor-'+id);if(view)view.hidden=editing;if(editor)editor.hidden=!editing;if(editing)document.getElementById('comment-input-'+id)?.focus();}
document.getElementById('edit-title')?.addEventListener('click',()=>setTitleEditing(true));document.getElementById('title-input')?.addEventListener('blur',saveTitle);document.getElementById('title-input')?.addEventListener('keydown',(event)=>{if(event.key==='Escape'){titleCancelled=true;event.currentTarget.value=originalTitle;setTitleEditing(false);}else if(event.key==='Enter'){event.preventDefault();saveTitle();}});
document.getElementById('open-browser')?.addEventListener('click',()=>post('openInBrowser'));document.getElementById('refresh')?.addEventListener('click',()=>post('refresh'));document.getElementById('edit-body')?.addEventListener('click',()=>setBodyEditing(true));document.getElementById('cancel-body')?.addEventListener('click',()=>setBodyEditing(false));document.getElementById('save-body')?.addEventListener('click',()=>post('editBody',{body:document.getElementById('body-input').value||''}));
document.querySelectorAll('.edit-comment').forEach((button)=>button.addEventListener('click',()=>setCommentEditing(button.dataset.commentId,true)));document.querySelectorAll('.cancel-comment').forEach((button)=>button.addEventListener('click',()=>setCommentEditing(button.dataset.commentId,false)));document.querySelectorAll('.save-comment').forEach((button)=>button.addEventListener('click',()=>{const id=button.dataset.commentId;const input=document.getElementById('comment-input-'+id);const body=(input?.value||'').trim();if(!body)return;post('editComment',{commentId:Number(id),body});}));
document.getElementById('post-comment')?.addEventListener('click',()=>{const input=document.getElementById('comment-body');const body=(input.value||'').trim();if(!body)return;post('addComment',{body});input.value='';});document.querySelectorAll('.markdown-body a[href]').forEach((link)=>link.addEventListener('click',(event)=>{event.preventDefault();post('openExternal',{url:link.getAttribute('href')});}));
</script>
</body>
</html>`;
  }

  dispose(): void {
    IssueDetailPanel.panels.delete(this.key);
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
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
