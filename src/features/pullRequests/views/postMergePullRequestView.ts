import * as vscode from "vscode";
import type { RepoManager, RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import {
  BranchCleanupService,
  planBranchCleanup,
  type BranchIdentity,
} from "../services/branchCleanupService";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

type MergedPullRequestState = Extract<
  PullRequestWorkspaceState,
  { kind: "merged" }
>;

type PostMergeMessage =
  | { type: "refreshBranches" }
  | { type: "deleteBranches" }
  | { type: "checkoutBase" }
  | { type: "createNew" };

interface CleanupQuickPickItem extends vscode.QuickPickItem {
  cleanupKind: "local" | "remote";
}

export class PostMergePullRequestViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.postMergePullRequest";

  private view: vscode.WebviewView | undefined;
  private identity: BranchIdentity | undefined;
  private loading = false;
  private busy = false;
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
      view.webview.onDidReceiveMessage((message: PostMergeMessage) =>
        this.handleMessage(message),
      ),
    );
    this.render();
    const state = this.mergedState();
    if (state) void this.loadIdentity(state);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private async handleMessage(message: PostMergeMessage): Promise<void> {
    if (this.busy) return;
    const state = this.mergedState();
    if (!state) return;

    switch (message.type) {
      case "refreshBranches":
        await this.loadIdentity(state, true);
        return;
      case "deleteBranches":
        await this.deleteBranches(state);
        return;
      case "checkoutBase":
        await this.checkoutBase(state);
        return;
      case "createNew":
        await this.session.clear();
        await vscode.commands.executeCommand("gitea.createPRSidebar");
        return;
    }
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

  private async ensureIdentity(
    state: MergedPullRequestState,
  ): Promise<{ repoInfo: RepoInfo; identity: BranchIdentity } | undefined> {
    const repoInfo = this.repoInfo(state);
    if (!repoInfo) {
      this.warning = `Repository ${state.repository.fullName} is no longer available in this workspace.`;
      this.render();
      return undefined;
    }
    if (!this.identity) await this.loadIdentity(state, true);
    if (!this.identity) return undefined;
    return { repoInfo, identity: this.identity };
  }

  private async deleteBranches(state: MergedPullRequestState): Promise<void> {
    const context = await this.ensureIdentity(state);
    if (!context) return;
    const plan = planBranchCleanup(context.identity);
    const items: CleanupQuickPickItem[] = [];
    if (plan.canDeleteLocal && plan.localBranch) {
      items.push({
        cleanupKind: "local",
        label: `$(git-branch) Local: ${plan.localBranch}`,
        description: plan.checkoutBaseRequired
          ? `Checkout ${plan.checkoutBase} first`
          : "Delete local branch",
        picked: true,
      });
    }
    if (plan.canDeleteRemote && plan.remoteBranch) {
      items.push({
        cleanupKind: "remote",
        label: `$(cloud) Remote: ${plan.remoteBranch.remote}/${plan.remoteBranch.branch}`,
        description: "Delete branch from remote",
        picked: true,
      });
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage("No merged head branch remains to delete.");
      return;
    }

    const selected = await vscode.window.showQuickPick<CleanupQuickPickItem>(items, {
      canPickMany: true,
      placeHolder: "Select branches to delete. Local and remote cleanup are independent.",
      title: `Clean up PR #${state.pullRequest.number}`,
    });
    if (!selected || selected.length === 0) return;

    const deleteLocal = selected.some((item) => item.cleanupKind === "local");
    const deleteRemote = selected.some((item) => item.cleanupKind === "remote");
    const labels = selected.map((item) => item.label.replace(/^\$\([^)]*\)\s*/, ""));
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${labels.join(" and ")}?`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") return;

    this.busy = true;
    this.warning = undefined;
    this.render();
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Cleaning up branches for PR #${state.pullRequest.number}...`,
        },
        () =>
          this.branchCleanup.cleanup(context.repoInfo, context.identity, {
            deleteLocal,
            deleteRemote,
          }),
      );

      if (result.errors.length > 0) {
        this.warning = result.errors.join(" | ");
        vscode.window.showErrorMessage(`Branch cleanup incomplete: ${this.warning}`);
        this.identity = undefined;
        await this.loadIdentity(state, true);
        return;
      }

      const deleted: string[] = [];
      if (result.localDeleted) deleted.push("local branch");
      if (result.remoteDeleted) deleted.push("remote branch");
      vscode.window.showInformationMessage(
        deleted.length > 0
          ? `Deleted ${deleted.join(" and ")} for PR #${state.pullRequest.number}.`
          : `No branch deletion was required for PR #${state.pullRequest.number}.`,
      );
      await this.session.clear();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async checkoutBase(state: MergedPullRequestState): Promise<void> {
    const context = await this.ensureIdentity(state);
    if (!context) return;

    this.busy = true;
    this.warning = undefined;
    this.render();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Checking out ${state.pullRequest.base.ref}...`,
        },
        () => this.branchCleanup.checkoutBase(context.repoInfo, context.identity),
      );
      vscode.window.showInformationMessage(
        `Checked out base branch: ${state.pullRequest.base.ref}`,
      );
      await this.session.clear();
    } catch (error) {
      this.warning = (error as Error).message;
      vscode.window.showErrorMessage(`Failed to checkout base branch: ${this.warning}`);
    } finally {
      this.busy = false;
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
    const plan = identity ? planBranchCleanup(identity) : undefined;
    const branchSummary = this.loading
      ? '<p class="muted">Resolving local and remote branch identity…</p>'
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
    const disabled = this.loading || this.busy ? "disabled" : "";
    const cleanupDisabled = !plan || (!plan.canDeleteLocal && !plan.canDeleteRemote) || this.loading || this.busy
      ? "disabled"
      : "";

    this.view.webview.html = this.html(`
      <div class="header">
        <div class="title">Pull request successfully merged</div>
        <div class="meta"><strong>#${pr.number}</strong> ${escapeHtml(pr.title)}</div>
        <div class="meta">${escapeHtml(state.repository.fullName)} · <code>${escapeHtml(pr.head.ref)}</code> → <code>${escapeHtml(pr.base.ref)}</code></div>
      </div>
      ${warning}
      <div class="section">
        <div class="section-title">Branch state</div>
        ${branchSummary}
      </div>
      <div class="section">
        <div class="section-title">Next action</div>
        <div class="actions">
          <button id="create" ${disabled}>Create New Pull Request…</button>
          <button id="delete" ${cleanupDisabled}>Delete Branch…</button>
          <button id="checkout" class="secondary" ${disabled}>Checkout '${escapeHtml(pr.base.ref)}' without deleting branch</button>
          <button id="refresh" class="secondary" ${disabled}>Refresh branch state</button>
        </div>
        <p class="muted">Use the × title action to keep branches and finish.</p>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('create')?.addEventListener('click', () => vscode.postMessage({ type: 'createNew' }));
        document.getElementById('delete')?.addEventListener('click', () => vscode.postMessage({ type: 'deleteBranches' }));
        document.getElementById('checkout')?.addEventListener('click', () => vscode.postMessage({ type: 'checkoutBase' }));
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
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px; }
  code { font-family: var(--vscode-editor-font-family); }
  .header { margin-bottom: 12px; }
  .title { font-weight: 600; margin-bottom: 4px; }
  .meta, .muted { color: var(--vscode-descriptionForeground); }
  .section { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--vscode-panel-border); }
  .section-title { font-weight: 600; margin-bottom: 6px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; }
  dt { color: var(--vscode-descriptionForeground); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .actions { display: grid; gap: 7px; margin-top: 8px; }
  button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 7px 12px; cursor: pointer; text-align: left; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: .55; cursor: default; }
  .warning { color: var(--vscode-errorForeground); }
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
