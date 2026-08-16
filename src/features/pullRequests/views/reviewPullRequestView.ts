import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import type {
  GiteaCombinedStatus,
  GiteaReview,
} from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { RepoManager } from "../../../context/repoManager";
import { PullRequestProvider } from "../../../views/pullRequestProvider";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import {
  evaluateMergeReadiness,
  preferredMergeMethod,
  supportedMergeMethods,
  type BranchMergePolicy,
  type MergeMethod,
  type MergeReadiness,
  type RepositoryMergeSettings,
} from "../domain/reviewPullRequestModel";
import { PullRequestReviewApi } from "../services/pullRequestReviewApi";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

type ActivePullRequestState = Extract<
  PullRequestWorkspaceState,
  { kind: "active" }
>;

interface ReadinessState {
  loading: boolean;
  identity?: string;
  status?: GiteaCombinedStatus;
  reviews?: GiteaReview[];
  mergeSettings?: RepositoryMergeSettings;
  branchPolicy?: BranchMergePolicy;
  warning?: string;
}

type ReviewViewMessage =
  | { type: "comment"; body: string }
  | { type: "approve"; body: string }
  | { type: "requestChanges"; body: string }
  | { type: "selectMergeMethod"; method: MergeMethod }
  | { type: "merge" }
  | { type: "checkoutBase" }
  | { type: "refresh" };

const MERGE_METHOD_STATE_KEY = "gitea.prReview.mergeMethod";

export class ReviewPullRequestViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.reviewPullRequest";

  private view: vscode.WebviewView | undefined;
  private reviewBody = "";
  private busy = false;
  private readiness: ReadinessState = { loading: false };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly reviewApi: PullRequestReviewApi,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly prProvider: PullRequestProvider,
    private readonly workspaceState: vscode.Memento,
  ) {
    this.disposables.push(
      this.session.onDidChangeState((state) => {
        this.reviewBody = "";
        this.readiness = { loading: false };
        this.render();
        if (state.kind === "active") {
          const repoInfo = this.repoManager
            .getRepos()
            .find((repo) => repo.key === state.repository.key);
          if (repoInfo) {
            void this.loadReadiness(repoInfo, state);
          }
        }
      }),
      this.repoManager.onDidChange(() => {
        this.render();
        const active = this.activeContext();
        if (active) void this.loadReadiness(active.repoInfo, active.state);
      }),
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
    const active = this.activeContext();
    if (active) void this.loadReadiness(active.repoInfo, active.state);
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
      const refreshed = this.activeContext();
      if (refreshed) await this.loadReadiness(refreshed.repoInfo, refreshed.state);
      return;
    }

    if (message.type === "selectMergeMethod") {
      const supported = supportedMergeMethods(this.readiness.mergeSettings);
      if (supported.includes(message.method)) {
        await this.workspaceState.update(MERGE_METHOD_STATE_KEY, message.method);
        this.render();
      }
      return;
    }

    if (message.type === "merge") {
      await this.merge(active.repoInfo, active.state);
      return;
    }

    if (message.type === "checkoutBase") {
      await this.checkoutBase(active.repoInfo, active.state);
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
      const refreshed = this.activeContext();
      if (refreshed) await this.loadReadiness(refreshed.repoInfo, refreshed.state);
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

  private async loadReadiness(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
  ): Promise<void> {
    const identity = `${repoInfo.key}#${state.pullRequest.number}@${state.pullRequest.head.sha}`;
    this.readiness = { loading: true, identity };
    this.render();

    const [status, reviews, mergeSettings, branchPolicy] = await Promise.allSettled([
      this.reviewApi.getCombinedStatus(repoInfo, state.pullRequest.head.sha),
      this.api.listReviews(repoInfo, state.pullRequest.number),
      this.reviewApi.getRepositoryMergeSettings(repoInfo),
      this.reviewApi.getBranchMergePolicy(repoInfo, state.pullRequest.base.ref),
    ]);

    const current = this.activeContext();
    if (
      !current ||
      `${current.repoInfo.key}#${current.state.pullRequest.number}@${current.state.pullRequest.head.sha}` !== identity
    ) {
      return;
    }

    const warnings = [status, reviews, mergeSettings, branchPolicy]
      .filter((result) => result.status === "rejected")
      .map((result) => (result as PromiseRejectedResult).reason as Error)
      .map((error) => error.message);

    this.readiness = {
      loading: false,
      identity,
      status: status.status === "fulfilled" ? status.value : undefined,
      reviews: reviews.status === "fulfilled" ? reviews.value : undefined,
      mergeSettings:
        mergeSettings.status === "fulfilled" ? mergeSettings.value : undefined,
      branchPolicy:
        branchPolicy.status === "fulfilled" ? branchPolicy.value : undefined,
      warning: warnings.length > 0 ? warnings.join(" | ") : undefined,
    };
    this.render();
  }

  private currentReadiness(state: ActivePullRequestState): MergeReadiness {
    return evaluateMergeReadiness(
      state.pullRequest,
      this.readiness.status,
      this.readiness.reviews,
      this.readiness.branchPolicy,
    );
  }

  private selectedMergeMethod(): MergeMethod | undefined {
    const supported = supportedMergeMethods(this.readiness.mergeSettings);
    return preferredMergeMethod(
      supported,
      this.workspaceState.get<MergeMethod>(MERGE_METHOD_STATE_KEY),
      this.readiness.mergeSettings?.default_merge_style,
    );
  }

  private async merge(
    repoInfo: RepoInfo,
    originalState: ActivePullRequestState,
  ): Promise<void> {
    this.busy = true;
    this.render();
    try {
      const latestPr = await this.api.getPullRequest(
        repoInfo,
        originalState.pullRequest.number,
      );
      await this.session.activate(
        originalState.repository,
        latestPr,
        originalState.checkoutState,
      );
      const refreshed = this.activeContext();
      if (!refreshed) return;

      await this.loadReadiness(refreshed.repoInfo, refreshed.state);
      const readiness = this.currentReadiness(refreshed.state);
      if (!readiness.canMerge) {
        vscode.window.showWarningMessage(
          `PR #${latestPr.number} cannot be merged: ${readiness.blockingReasons.join("; ")}`,
        );
        return;
      }

      const method = this.selectedMergeMethod();
      if (!method) {
        vscode.window.showWarningMessage(
          "No supported merge method is enabled for this repository.",
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Merge PR #${latestPr.number} using ${mergeMethodLabel(method)}?`,
        { modal: true },
        "Merge",
      );
      if (confirm !== "Merge") return;

      await this.api.mergePullRequest(repoInfo, latestPr.number, method);

      let mergedPr = latestPr;
      try {
        mergedPr = await this.api.getPullRequest(repoInfo, latestPr.number);
      } catch {
        mergedPr = { ...latestPr, merged: true, state: "closed" };
      }
      const presence = await this.branchPresence(repoInfo, latestPr.head.ref);
      await this.session.markMerged(originalState.repository, mergedPr, presence);
      this.prProvider.refresh();
      vscode.window.showInformationMessage(
        `PR #${latestPr.number} merged using ${mergeMethodLabel(method)}.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Merge failed: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async checkoutBase(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
  ): Promise<void> {
    const branch = state.pullRequest.base.ref;
    const repository = await this.gitRepository(repoInfo);
    if (!repository) return;

    this.busy = true;
    this.render();
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Checking out ${branch}...`,
        },
        async () => {
          try {
            await repository.fetch({ remote: "origin", ref: branch });
            await repository.checkout(branch);
          } catch {
            await repository.checkout(`origin/${branch}`, {
              createNewBranch: true,
              newBranchName: branch,
            });
          }
        },
      );
      await this.session.setCheckoutState({ kind: "notCheckedOut" });
      vscode.window.showInformationMessage(`Checked out base branch: ${branch}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to checkout base branch: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async branchPresence(
    repoInfo: RepoInfo,
    branch: string,
  ): Promise<{ localBranchExists: boolean; remoteBranchExists: boolean }> {
    const repository = await this.gitRepository(repoInfo, false);
    if (!repository) {
      return { localBranchExists: false, remoteBranchExists: false };
    }

    try {
      await repository.fetch({ remote: "origin" });
    } catch {
      // Presence is best effort; local refs may still be useful for Phase 4.
    }

    const refs = repository.state.refs as Array<{ name?: string; remote?: string }>;
    return {
      localBranchExists: refs.some(
        (ref) => ref.name === branch && !ref.remote,
      ),
      remoteBranchExists: refs.some(
        (ref) =>
          ref.name === `origin/${branch}` ||
          (ref.remote === "origin" && ref.name === branch),
      ),
    };
  }

  private async gitRepository(
    repoInfo: RepoInfo,
    showErrors = true,
  ): Promise<any | undefined> {
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (!gitExt) {
      if (showErrors) vscode.window.showErrorMessage("Git extension not available.");
      return undefined;
    }

    const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
    const repositories = git.getAPI(1).repositories as Array<{
      rootUri: vscode.Uri;
      fetch: (...args: any[]) => Promise<void>;
      checkout: (...args: any[]) => Promise<void>;
      state: { refs: unknown[] };
    }>;
    const repository = repositories.find(
      (repo) => repo.rootUri.fsPath === repoInfo.rootPath,
    );
    if (!repository && showErrors) {
      vscode.window.showErrorMessage(
        `No git repository found for ${repoInfo.label}.`,
      );
    }
    return repository;
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
    const readiness = this.currentReadiness(active.state);
    const supported = supportedMergeMethods(this.readiness.mergeSettings);
    const selected = this.selectedMergeMethod();
    const mergeDisabled =
      this.busy || this.readiness.loading || !readiness.canMerge || !selected;
    const methodOptions = supported
      .map(
        (method) =>
          `<option value="${method}"${method === selected ? " selected" : ""}>${escapeHtml(mergeMethodLabel(method))}</option>`,
      )
      .join("");
    const blockers = readiness.blockingReasons
      .map((reason) => `<li>${escapeHtml(reason)}</li>`)
      .join("");
    const warnings = readiness.warnings
      .map((warning) => `<li>${escapeHtml(warning)}</li>`)
      .join("");
    const checks = (this.readiness.status?.statuses ?? [])
      .map(
        (status) =>
          `<li>${escapeHtml(status.context || "check")} · ${escapeHtml(status.state)}${status.description ? ` — ${escapeHtml(status.description)}` : ""}</li>`,
      )
      .join("");

    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .header { margin-bottom: 12px; }
  .title { font-weight: 600; margin-bottom: 4px; }
  .meta, .muted { color: var(--vscode-descriptionForeground); }
  textarea, select { box-sizing: border-box; width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; }
  textarea { min-height: 110px; resize: vertical; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  button { border: 0; padding: 6px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.danger { color: var(--vscode-errorForeground); background: var(--vscode-button-secondaryBackground); }
  button:disabled, select:disabled { opacity: 0.55; cursor: default; }
  .section { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--vscode-panel-border); }
  .section-title { font-weight: 600; margin-bottom: 6px; }
  ul { margin: 6px 0; padding-left: 20px; }
  .blocked { color: var(--vscode-errorForeground); }
  .ready { color: var(--vscode-testing-iconPassed); }
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

  <div class="section">
    <div class="section-title">Merge readiness</div>
    <div>${stateLabel} · ${mergeable}</div>
    <div>${escapeHtml(readiness.reviewLabel)} · ${escapeHtml(readiness.ciLabel)}</div>
    ${this.readiness.loading ? '<div class="muted">Refreshing merge readiness…</div>' : ""}
    ${blockers ? `<ul class="blocked">${blockers}</ul>` : '<div class="ready">No blocking condition detected from available Gitea signals.</div>'}
    ${warnings ? `<ul class="muted">${warnings}</ul>` : ""}
    ${this.readiness.warning ? `<div class="muted">Some readiness metadata is unavailable: ${escapeHtml(this.readiness.warning)}</div>` : ""}
    ${checks ? `<ul>${checks}</ul>` : ""}
  </div>

  <div class="section">
    <div class="section-title">Merge</div>
    <select id="mergeMethod"${this.busy || supported.length === 0 ? " disabled" : ""}>${methodOptions}</select>
    <div class="actions">
      <button id="merge"${mergeDisabled ? " disabled" : ""}>Merge</button>
      <button class="secondary" id="checkoutBase"${disabled}>Checkout '${escapeHtml(pr.base.ref)}'</button>
    </div>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const body = document.getElementById('reviewBody');
  const mergeMethod = document.getElementById('mergeMethod');
  document.getElementById('comment').addEventListener('click', () => vscode.postMessage({ type: 'comment', body: body.value }));
  document.getElementById('approve').addEventListener('click', () => vscode.postMessage({ type: 'approve', body: body.value }));
  document.getElementById('requestChanges').addEventListener('click', () => vscode.postMessage({ type: 'requestChanges', body: body.value }));
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  if (mergeMethod) mergeMethod.addEventListener('change', () => vscode.postMessage({ type: 'selectMergeMethod', method: mergeMethod.value }));
  document.getElementById('merge').addEventListener('click', () => vscode.postMessage({ type: 'merge' }));
  document.getElementById('checkoutBase').addEventListener('click', () => vscode.postMessage({ type: 'checkoutBase' }));
</script>
</body>
</html>`;
  }

  private emptyHtml(): string {
    return `<!doctype html><html><body style="padding:12px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-font-family)">Activate a Gitea pull request to review it from the sidebar.</body></html>`;
  }
}

function mergeMethodLabel(method: MergeMethod): string {
  switch (method) {
    case "squash":
      return "Squash and Merge";
    case "rebase":
      return "Rebase and Merge";
    default:
      return "Create Merge Commit";
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
