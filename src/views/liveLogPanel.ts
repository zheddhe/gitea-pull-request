import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import type { RepoInfo } from "../context/repoManager";
import type { GiteaWorkflowJob } from "../api/types";

interface LiveLogMessage {
  command: "refresh" | "openInBrowser" | "stopStreaming";
}

export class LiveLogPanel {
  private static panels = new Map<number, LiveLogPanel>();
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private logContent: string = "";
  private pollingTimer?: ReturnType<typeof setInterval>;
  private isJobComplete: boolean = false;
  private lastLogLength: number = 0;

  static async show(
    api: GiteaApiClient,
    repoInfo: RepoInfo,
    job: GiteaWorkflowJob,
  ): Promise<void> {
    const existing = LiveLogPanel.panels.get(job.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "giteaLiveLogs",
      `📋 ${job.name}`,
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
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      (msg: LiveLogMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    // Check if job is already complete
    this.isJobComplete =
      job.status === "completed" ||
      job.conclusion === "success" ||
      job.conclusion === "failure" ||
      job.conclusion === "cancelled" ||
      job.conclusion === "skipped";

    this.updateHtml();
  }

  private async handleMessage(msg: LiveLogMessage): Promise<void> {
    switch (msg.command) {
      case "refresh":
        await this.fetchLogs();
        break;
      case "openInBrowser":
        if (this.job.html_url) {
          vscode.env.openExternal(vscode.Uri.parse(this.job.html_url));
        }
        break;
      case "stopStreaming":
        this.stopStreaming();
        break;
    }
  }

  private async startStreaming(): Promise<void> {
    // Initial fetch
    await this.fetchLogs();

    // Don't poll if job is already complete
    if (this.isJobComplete) {
      return;
    }

    // Poll every 2 seconds for log updates
    this.pollingTimer = setInterval(async () => {
      if (!this.isJobComplete) {
        await this.fetchLogs();
      } else {
        this.stopStreaming();
      }
    }, 2000);
  }

  private stopStreaming(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private async fetchLogs(): Promise<void> {
    try {
      // Fetch job status to check if it's complete
      const jobs = await this.api.listWorkflowJobs(
        this.repoInfo,
        this.job.run_id,
      );
      const updatedJob = jobs.find((j) => j.id === this.job.id);

      if (updatedJob) {
        this.job = updatedJob;
        this.isJobComplete =
          updatedJob.status === "completed" ||
          updatedJob.conclusion === "success" ||
          updatedJob.conclusion === "failure" ||
          updatedJob.conclusion === "cancelled" ||
          updatedJob.conclusion === "skipped";

        // Update title with job status
        const statusEmoji = this.getStatusEmoji(
          updatedJob.conclusion || updatedJob.status,
        );
        this.panel.title = `${statusEmoji} ${updatedJob.name}`;
      }

      // Fetch logs
      const logs = await this.api.getJobLogs(this.repoInfo, this.job.id);
      const newLogsAdded = logs.length > this.lastLogLength;
      this.lastLogLength = logs.length;
      this.logContent = logs;

      // Send update to webview
      this.panel.webview.postMessage({
        type: "updateLogs",
        content: this.logContent,
        isComplete: this.isJobComplete,
        autoScroll: newLogsAdded && !this.isJobComplete,
      });
    } catch {
      // Silently handle errors during streaming
    }
  }

  private getStatusEmoji(status: string): string {
    const statusEmojis: Record<string, string> = {
      success: "✅",
      failure: "❌",
      running: "⏳",
      waiting: "⏸",
      pending: "⏸",
      cancelled: "🚫",
      skipped: "⏭",
      completed: "✅",
    };
    return statusEmojis[status] ?? "📋";
  }

  private updateHtml(): void {
    this.panel.webview.html = this.getHtmlContent();
  }

  private getHtmlContent(): string {
    const isStreaming = !this.isJobComplete;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Live Logs</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            padding: 8px 12px;
            background: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: 600;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .streaming-indicator {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--vscode-charts-green);
            font-size: 0.85em;
        }
        .pulse {
            width: 8px;
            height: 8px;
            background: var(--vscode-charts-green);
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        .actions {
            margin-left: auto;
            display: flex;
            gap: 4px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .log-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: auto;
            padding: 12px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
            white-space: pre;
        }
        .log-line {
            display: block;
            padding: 1px 0;
        }
        .log-line:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .loading {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="header">
        <strong>${escHtml(this.job.name)}</strong>
        <span class="status-badge">${escHtml(this.job.conclusion || this.job.status)}</span>
        ${
          isStreaming
            ? `
        <span class="streaming-indicator">
            <span class="pulse"></span>
            Live streaming
        </span>
        `
            : ""
        }
        <div class="actions">
            <button class="secondary" onclick="refresh()">🔄 Refresh</button>
            ${
              isStreaming
                ? `<button class="secondary" onclick="stopStreaming()">⏹ Stop</button>`
                : ""
            }
            <button onclick="openInBrowser()">🔗 Browser</button>
        </div>
    </div>
    <div id="logs" class="log-container">
        <div class="loading">Loading logs...</div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const logsContainer = document.getElementById('logs');
        let autoScrollEnabled = true;
        let lastScrollTop = 0;

        // Detect if user scrolled up manually
        logsContainer.addEventListener('scroll', () => {
            const scrollTop = logsContainer.scrollTop;
            const scrollHeight = logsContainer.scrollHeight;
            const clientHeight = logsContainer.clientHeight;
            
            // If user scrolled up, disable auto-scroll
            if (scrollTop < lastScrollTop) {
                autoScrollEnabled = false;
            }
            
            // If user scrolled to bottom, enable auto-scroll again
            if (scrollTop + clientHeight >= scrollHeight - 10) {
                autoScrollEnabled = true;
            }
            
            lastScrollTop = scrollTop;
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateLogs') {
                updateLogs(message.content, message.isComplete, message.autoScroll);
            }
        });

        function updateLogs(content, isComplete, autoScroll) {
            if (!content) {
                logsContainer.innerHTML = '<div class="loading">No logs available yet...</div>';
                return;
            }

            const lines = content.split('\\n');
            logsContainer.innerHTML = lines
                .map((line, idx) => \`<span class="log-line">\${escapeHtml(line)}</span>\`)
                .join('');

            if (autoScroll && autoScrollEnabled) {
                scrollToBottom();
            }

            if (isComplete && !${!isStreaming}) {
                // Job completed, reload to update UI
                location.reload();
            }
        }

        function scrollToBottom() {
            logsContainer.scrollTop = logsContainer.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function openInBrowser() {
            vscode.postMessage({ command: 'openInBrowser' });
        }

        function stopStreaming() {
            vscode.postMessage({ command: 'stopStreaming' });
            autoScrollEnabled = false;
        }
    </script>
</body>
</html>`;
  }

  dispose(): void {
    LiveLogPanel.panels.delete(this.job.id);
    this.stopStreaming();
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
