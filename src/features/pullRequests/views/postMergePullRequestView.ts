import * as vscode from "vscode";
import type { RepoManager, RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import {
  BranchCleanupService,
  type BranchIdentity,
} from "../services/branchCleanupService";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

type MergedPullRequestState = Extract<
  PullRequestWorkspaceState,
  { kind: "merged" }
>;

type PostMergeMessage = { type: "refreshBranches" };

export class PostMergePullRequestViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.postMergePullRequest";

  private view: vscode.WebviewView | undefined;
  private identity: BranchIdentity | undefined;
  private loading = false;
  private warning: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly branchCleanup: BranchCleanupService,
  ) {
    this.disposables.push(
      this.session.onDidChangeState((state) => {
        this.identity = undefined;
        this.warning = undefined;
        this.render();
        if (state.kind === "merged") {
          void this.loadIdentity(state);
          void vscode.commands.executeCommand(
            `${PostMergePullRequestViewProvider.viewType}.focus`,
          );
        }
      }),
      this.repoManager.onDidChange(() => {
        this.render();
        const state = this.mergedState();
        if (state) void this.loadIdentity(state);
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: PostMergeMessage) => {
        if (message.type === "refreshBranches") {
          const state = this.mergedState();
          if (state) void this.loadIdentity(state, true);
        }
      }),
    );
    this.render();
    const state = this.mergedState();
    if (state) void this.loadIdentity(state);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private mergedState(): MergedPullRequestState | undefined {
    const state = this.session.current;
    return state.kind === "merged" ? state : undefined;
  }

  private repoInfo(state: MergedPullRequestState): RepoInfo | undefined {
    return this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
  }

  private async loadIdentity(
    state: MergedPullRequestState,
    force = false,
  ): Promise<void> {
    if (this.loading || (this.identity && !force)) return;
    const repoInfo = this.repoInfo(state);
    if (!repoInfo) {
      this.warning = `Repository ${state.repository.fullName} is no longer available in this workspace.`;
      this.render();
      return;
    }

    this.loading = true;
    this.warning = undefined;
    this.render();
    try {
      this.identity = await this.branchCleanup.discover(
        repoInfo,
        state.pullRequest.head.ref,
        state.pullRequest.base.ref,
      );
      log(`[post-merge-view] branch identity ready repo=${repoInfo.label} pr=#${state.pullRequest.number}`);
    } catch (error) {
      this.warning = (error as Error).message;
      log(`[post-merge-view] branch identity failed: ${this.warning}`);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.view) return;
    const state = this.mergedState();
    if (!state) {
      this.view.webview.html = this.html("<p>No merged pull request is currently awaiting cleanup.</p>");
      return;
    }

    const pr = state.pullRequest;
    this.view.title = `Pull Request #${pr.number} Merged`;
    const identity = this.identity;
    const branchSummary = this.loading
      ? "<p>Resolving local and remote branch identity...</p>"
      : identity
        ? `<dl>
            <dt>PR head</dt><dd><code>${escapeHtml(identity.prHead)}</code></dd>
            <dt>Local branch</dt><dd>${identity.localHead ? `<code>${escapeHtml(identity.localHead)}</code>${identity.localHeadCheckedOut ? " (checked out)" : ""}` : "Not found"}</dd>
            <dt>Remote branch</dt><dd>${identity.remoteHead ? `<code>${escapeHtml(identity.remoteHead.remote)}/${escapeHtml(identity.remoteHead.branch)}</code>` : "Not found"}</dd>
            <dt>Base</dt><dd><code>${escapeHtml(identity.base)}</code></dd>
            <dt>Current branch</dt><dd>${identity.currentBranch ? `<code>${escapeHtml(identity.currentBranch)}</code>` : "Detached / unavailable"}</dd>
          </dl>`
        : "";

    const warning = this.warning
      ? `<p class="warning">${escapeHtml(this.warning)}</p>`
      : "";

    this.view.webview.html = this.html(`
      <h3>Pull request successfully merged.</h3>
      <p><strong>#${pr.number}</strong> ${escapeHtml(pr.title)}</p>
      <p>${escapeHtml(state.repository.fullName)} · <code>${escapeHtml(pr.head.ref)}</code> → <code>${escapeHtml(pr.base.ref)}</code></p>
      ${warning}
      <h4>Branch state</h4>
      ${branchSummary}
      <button id="refresh" ${this.loading ? "disabled" : ""}>Refresh branch state</button>
      <p class="muted">Cleanup actions are enabled in the next Phase 4 increments after branch identity has been validated.</p>
      <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refreshBranches' }));
      </script>
    `);
  }

  private html(body: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px 12px; }
  code { font-family: var(--vscode-editor-font-family); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; }
  dt { color: var(--vscode-descriptionForeground); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 6px 12px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .55; cursor: default; }
  .warning { color: var(--vscode-errorForeground); }
  .muted { color: var(--vscode-descriptionForeground); margin-top: 12px; }
</style>
</head>
<body>${body}</body>
</html>`;
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
