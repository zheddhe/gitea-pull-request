import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import type { RepoInfo } from "../../../context/repoManager";
import { RepoManager } from "../../../context/repoManager";
import { PullRequestProvider } from "../../../views/pullRequestProvider";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

type ActivePullRequestState = Extract<
  PullRequestWorkspaceState,
  { kind: "active" }
>;

type ReviewViewMessage =
  | { type: "comment"; body: string }
  | { type: "approve"; body: string }
  | { type: "requestChanges"; body: string }
  | { type: "refresh" };

export class ReviewPullRequestViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.reviewPullRequest";

  private view: vscode.WebviewView | undefined;
  private reviewBody = "";
  private busy = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly prProvider: PullRequestProvider,
  ) {
    this.disposables.push(
      this.session.onDidChangeState(() => {
        this.reviewBody = "";
        this.render();
      }),
      this.repoManager.onDidChange(() => this.render()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: ReviewViewMessage) =>
        this.handleMessage(message),
      ),
    );
    this.render();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private activeContext():
    | { repoInfo: RepoInfo; state: ActivePullRequestState }
    | undefined {
    const state = this.session.current;
    if (state.kind !== "active") {
      return undefined;
    }

    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    if (!repoInfo) {
      return undefined;
    }

    return { repoInfo, state };
  }

  private async handleMessage(message: ReviewViewMessage): Promise<void> {
    if (this.busy) {
      return;
    }

    const active = this.activeContext();
    if (!active) {
      vscode.window.showWarningMessage(
        "No active Gitea pull request is available for review.",
      );
      return;
    }

    if (message.type === "refresh") {
      await this.refreshActivePullRequest(active.repoInfo);
      return;
    }

    this.reviewBody = message.body;
    const body = message.body.trim();

    if (message.type === "comment" && !body) {
      vscode.window.showWarningMessage("A comment body is required.");
      return;
    }
    if (message.type === "requestChanges" && !body) {
      vscode.window.showWarningMessage(
        "Describe the requested changes before submitting the review.",
      );
      return;
    }

    const number = active.state.pullRequest.number;
    this.busy = true;
    this.render();

    try {
      if (message.type === "comment") {
        await this.api.addPRComment(active.repoInfo, number, body);
        vscode.window.showInformationMessage(`Comment posted on PR #${number}.`);
      } else if (message.type === "approve") {
        await this.api.createReview(
          active.repoInfo,
          number,
          "APPROVED",
          body,
        );
        vscode.window.showInformationMessage(`PR #${number} approved.`);
      } else {
        await this.api.createReview(
          active.repoInfo,
          number,
          "REQUEST_CHANGES",
          body,
        );
        vscode.window.showInformationMessage(`Changes requested on PR #${number}.`);
      }

      this.reviewBody = "";
      await this.refreshActivePullRequest(active.repoInfo);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to update PR #${number}: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async refreshActivePullRequest(repoInfo: RepoInfo): Promise<void> {
    const state = this.session.current;
    if (state.kind !== "active" || state.repository.key !== repoInfo.key) {
      return;
    }

    try {
      const pullRequest = await this.api.getPullRequest(
        repoInfo,
        state.pullRequest.number,
      );
      await this.session.activate(
        state.repository,
        pullRequest,
        state.checkoutState,
      );
      this.prProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to refresh active pull request: ${(error as Error).message}`,
      );
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    const active = this.activeContext();
    if (!active) {
      this.view.webview.html = this.emptyHtml();
      return;
    }

    const pr = active.state.pullRequest;
    this.view.title = `Review Pull Request #${pr.number}`;

    const stateLabel = pr.merged
      ? "Merged"
      : pr.state === "closed"
        ? "Closed"
        : "Open";
    const mergeable =
      pr.mergeable === true
        ? "Mergeable"
        : pr.mergeable === false
          ? "Not mergeable"
          : "Mergeability unknown";
    const disabled = this.busy ? " disabled" : "";

    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .header { margin-bottom: 12px; }
  .title { font-weight: 600; margin-bottom: 4px; }
  .meta { color: var(--vscode-descriptionForeground); }
  textarea { box-sizing: border-box; width: 100%; min-height: 110px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  button { border: 0; padding: 6px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.danger { color: var(--vscode-errorForeground); background: var(--vscode-button-secondaryBackground); }
  button:disabled { opacity: 0.55; cursor: default; }
  .summary { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="header">
    <div class="title">#${pr.number} ${escapeHtml(pr.title)}</div>
    <div class="meta">${escapeHtml(active.repoInfo.label)} · ${escapeHtml(pr.head.ref)} → ${escapeHtml(pr.base.ref)}</div>
  </div>

  <textarea id="reviewBody" placeholder="Leave a comment or review message">${escapeHtml(this.reviewBody)}</textarea>
  <div class="actions">
    <button id="comment"${disabled}>Comment</button>
    <button class="secondary" id="approve"${disabled}>Approve</button>
    <button class="danger" id="requestChanges"${disabled}>Request Changes</button>
    <button class="secondary" id="refresh"${disabled}>Refresh</button>
  </div>

  <div class="summary">${stateLabel} · ${mergeable}</div>
<script>
  const vscode = acquireVsCodeApi();
  const body = document.getElementById('reviewBody');
  document.getElementById('comment').addEventListener('click', () => vscode.postMessage({ type: 'comment', body: body.value }));
  document.getElementById('approve').addEventListener('click', () => vscode.postMessage({ type: 'approve', body: body.value }));
  document.getElementById('requestChanges').addEventListener('click', () => vscode.postMessage({ type: 'requestChanges', body: body.value }));
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
</script>
</body>
</html>`;
  }

  private emptyHtml(): string {
    return `<!doctype html><html><body style="padding:12px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-font-family)">Activate a Gitea pull request to review it from the sidebar.</body></html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
