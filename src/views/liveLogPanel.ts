import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import type { GiteaWorkflowJob } from "../api/types";
import type { RepoInfo } from "../context/repoManager";

interface LiveLogMessage {
  command: "refresh" | "openInBrowser";
}

export class LiveLogPanel {
  private static panels = new Map<number, LiveLogPanel>();
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private pollingTimer?: ReturnType<typeof setInterval>;
  private isJobComplete = false;
  private lastLogLength = 0;

  static async show(
    api: GiteaApiClient,
    repoInfo: RepoInfo,
    job: GiteaWorkflowJob,
  ): Promise<void> {
    const existing = LiveLogPanel.panels.get(job.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      await existing.fetchLogs();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "giteaLiveLogs",
      `Job: ${job.name}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    const instance = new LiveLogPanel(panel, api, repoInfo, job);
    LiveLogPanel.panels.set(job.id, instance);
    await instance.startStreaming();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly api: GiteaApiClient,
    private readonly repoInfo: RepoInfo,
    private job: GiteaWorkflowJob,
  ) {
    this.panel = panel;
    this.isJobComplete = isComplete(job);
    panel.webview.html = this.getHtmlContent();

    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      (message: LiveLogMessage) => void this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  private async handleMessage(message: LiveLogMessage): Promise<void> {
    if (message.command === "refresh") {
      await this.fetchLogs();
      return;
    }
    if (message.command === "openInBrowser" && this.job.html_url) {
      await vscode.env.openExternal(vscode.Uri.parse(this.job.html_url));
    }
  }

  private async startStreaming(): Promise<void> {
    await this.fetchLogs();
    if (this.isJobComplete) return;

    this.pollingTimer = setInterval(() => {
      if (this.isJobComplete) {
        this.stopStreaming();
        return;
      }
      void this.fetchLogs();
    }, 2000);
  }

  private stopStreaming(): void {
    if (!this.pollingTimer) return;
    clearInterval(this.pollingTimer);
    this.pollingTimer = undefined;
  }

  private async fetchLogs(): Promise<void> {
    try {
      const updatedJob = await this.api.getWorkflowJob(this.repoInfo, this.job.id);
      this.job = updatedJob;
      this.isJobComplete = isComplete(updatedJob);
      this.panel.title = `Job: ${updatedJob.name}`;

      const logs = await this.api.getJobLogs(this.repoInfo, updatedJob.id);
      const newLogsAdded = logs.length > this.lastLogLength;
      this.lastLogLength = logs.length;

      await this.panel.webview.postMessage({
        type: "update",
        content: logs,
        status: displayStatus(updatedJob),
        statusClass: statusClass(updatedJob),
        isComplete: this.isJobComplete,
        autoScroll: newLogsAdded && !this.isJobComplete,
        runner: updatedJob.runner_name || "—",
        startedAt: formatDateTime(updatedJob.started_at),
        completedAt: formatDateTime(updatedJob.completed_at),
      });

      if (this.isJobComplete) this.stopStreaming();
    } catch (error) {
      await this.panel.webview.postMessage({
        type: "error",
        message: (error as Error).message,
      });
    }
  }

  private getHtmlContent(): string {
    const nonce = getNonce();
    const status = displayStatus(this.job);
    const stateClass = statusClass(this.job);
    const refreshIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.2 3.8A6 6 0 1 0 14 9h-1.2a4.8 4.8 0 1 1-.7-4.3L10 6h5V1l-1.8 2.8z"/></svg>`;
    const externalIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9 2h5v5h-1V3.7L7.35 9.35l-.7-.7L12.3 3H9V2zM3 4h4v1H4v7h7V8h1v5H3V4z"/></svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(this.job.name)} logs</title>
<style>
:root{--surface:var(--vscode-editor-background);--subtle:var(--vscode-textBlockQuote-background,var(--vscode-editor-inactiveSelectionBackground));--fg:var(--vscode-foreground);--muted:var(--vscode-descriptionForeground);--border:var(--vscode-panel-border,var(--vscode-widget-border));--success:var(--vscode-testing-iconPassed,var(--vscode-charts-green));--danger:var(--vscode-testing-iconFailed,var(--vscode-errorForeground));--warning:var(--vscode-charts-yellow);--mono:var(--vscode-editor-font-family)}
*{box-sizing:border-box}html,body{margin:0;background:var(--surface);color:var(--fg);height:100%}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);line-height:1.45;padding:16px 20px;display:flex;flex-direction:column;min-height:0}
.title-row{display:flex;align-items:center;gap:7px;min-width:0;margin-bottom:5px;white-space:nowrap}.state-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:currentColor}.state-success{color:var(--success)}.state-failure{color:var(--danger)}.state-active{color:var(--warning)}.state-neutral{color:var(--muted)}.title-prefix,.title-text{font-size:1.22em;font-weight:600}.title-text{overflow:hidden;text-overflow:ellipsis}.title-actions{display:flex;gap:2px;margin-left:auto}.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:3px;border:0;border-radius:3px;background:transparent;color:var(--muted);cursor:pointer}.icon-btn:hover{background:var(--vscode-toolbar-hoverBackground,var(--subtle));color:var(--fg)}.icon-btn svg{width:15px;height:15px}.meta-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;color:var(--muted);font-size:.92em;margin-bottom:14px}.meta-row strong{color:var(--fg)}.badge{display:inline-flex;border:1px solid currentColor;border-radius:999px;padding:1px 7px;font-size:.82em;font-weight:600;text-transform:uppercase}.live{display:inline-flex;align-items:center;gap:5px}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--warning)}
.log-card{border:1px solid var(--border);border-radius:3px;overflow:hidden;display:flex;flex:1;min-height:0;flex-direction:column}.log-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;background:var(--subtle);border-bottom:1px solid var(--border);font-weight:600}.error{color:var(--danger);font-weight:400}.log-container{flex:1;min-height:0;overflow:auto;padding:10px 12px;font-family:var(--mono);white-space:pre;font-size:var(--vscode-editor-font-size);line-height:1.5}.log-line{display:block;min-height:1.5em}.log-line:hover{background:var(--vscode-list-hoverBackground)}.empty{color:var(--muted);font-style:italic}
</style>
</head>
<body>
<header>
  <div class="title-row">
    <span id="state-dot" class="state-dot ${stateClass}" aria-hidden="true"></span>
    <span class="title-prefix">CI Job</span>
    <span class="title-text">${escHtml(this.job.name)}</span>
    <div class="title-actions">
      <button id="refresh" class="icon-btn" title="Refresh job logs" aria-label="Refresh job logs">${refreshIcon}</button>
      <button id="open-browser" class="icon-btn" title="Open job in Browser" aria-label="Open job in browser">${externalIcon}</button>
    </div>
  </div>
  <div class="meta-row">
    <span id="status" class="badge ${stateClass}">${escHtml(status)}</span>
    <span><strong>${escHtml(this.repoInfo.owner)}/${escHtml(this.repoInfo.repo)}</strong></span>
    <span>Run #${this.job.run_id}</span>
    <span>Job #${this.job.id}</span>
    <span id="runner">Runner: ${escHtml(this.job.runner_name || "—")}</span>
    <span id="started">Started: ${escHtml(formatDateTime(this.job.started_at))}</span>
    <span id="completed">Completed: ${escHtml(formatDateTime(this.job.completed_at))}</span>
    <span id="live" class="live" ${this.isJobComplete ? "hidden" : ""}><span class="live-dot"></span>Live</span>
  </div>
</header>
<section class="log-card">
  <div class="log-bar"><span>Execution log</span><span id="error" class="error"></span></div>
  <div id="logs" class="log-container"><span class="empty">Loading logs...</span></div>
</section>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const logs=document.getElementById('logs');let autoScrollEnabled=true;let lastScrollTop=0;
logs.addEventListener('scroll',()=>{const top=logs.scrollTop;if(top<lastScrollTop)autoScrollEnabled=false;if(top+logs.clientHeight>=logs.scrollHeight-10)autoScrollEnabled=true;lastScrollTop=top;});
document.getElementById('refresh').addEventListener('click',()=>vscode.postMessage({command:'refresh'}));document.getElementById('open-browser').addEventListener('click',()=>vscode.postMessage({command:'openInBrowser'}));
window.addEventListener('message',(event)=>{const message=event.data;if(message.type==='error'){document.getElementById('error').textContent=message.message||'Unable to refresh';return;}if(message.type!=='update')return;document.getElementById('error').textContent='';const status=document.getElementById('status');const dot=document.getElementById('state-dot');status.textContent=message.status;status.className='badge '+message.statusClass;dot.className='state-dot '+message.statusClass;document.getElementById('runner').textContent='Runner: '+message.runner;document.getElementById('started').textContent='Started: '+message.startedAt;document.getElementById('completed').textContent='Completed: '+message.completedAt;document.getElementById('live').hidden=message.isComplete;renderLogs(message.content,message.autoScroll);});
function renderLogs(content,autoScroll){if(!content){logs.innerHTML='<span class="empty">No logs available yet.</span>';return;}logs.innerHTML=content.split('\\n').map((line)=>'<span class="log-line">'+escapeHtml(line)+'</span>').join('');if(autoScroll&&autoScrollEnabled)logs.scrollTop=logs.scrollHeight;}
function escapeHtml(text){const div=document.createElement('div');div.textContent=text;return div.innerHTML;}
</script>
</body>
</html>`;
  }

  dispose(): void {
    LiveLogPanel.panels.delete(this.job.id);
    this.stopStreaming();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}

function isComplete(job: GiteaWorkflowJob): boolean {
  const status = displayStatus(job);
  return ["success", "failure", "cancelled", "skipped", "completed"].includes(status);
}

function displayStatus(job: GiteaWorkflowJob): string {
  return (job.conclusion || job.status || "unknown").toLowerCase();
}

function statusClass(job: GiteaWorkflowJob): string {
  const status = displayStatus(job);
  if (status === "success" || status === "completed") return "state-success";
  if (status === "failure" || status === "failed" || status === "error") return "state-failure";
  if (["running", "waiting", "pending", "in_progress", "queued"].includes(status)) return "state-active";
  return "state-neutral";
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
