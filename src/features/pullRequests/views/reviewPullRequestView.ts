import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import type {
  GiteaCombinedStatus,
  GiteaReview,
} from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { RepoManager } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";
import { PullRequestProvider } from "../../../views/pullRequestProvider";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import {
  evaluateMergeReadiness,
  hasNoChangesToMerge,
  isWorkInProgress,
  preferredMergeMethod,
  readyForReviewTitle,
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

interface GitRefLike {
  name?: string;
  remote?: string;
}

interface GitRepositoryLike {
  rootUri: vscode.Uri;
  fetch(options: { remote: string; ref?: string }): Promise<void>;
  checkout(
    treeish: string,
    options?: { createNewBranch?: boolean; newBranchName?: string },
  ): Promise<void>;
  state: { refs: GitRefLike[] };
}

interface GitExtensionExportsLike {
  getAPI(version: number): { repositories: GitRepositoryLike[] };
}

type ReviewViewMessage =
  | { type: "comment"; body: string }
  | { type: "approve"; body: string }
  | { type: "requestChanges"; body: string }
  | { type: "readyForReview" }
  | { type: "selectMergeMethod"; method: MergeMethod }
  | { type: "merge" }
  | { type: "checkoutBase" }
  | { type: "openCheck"; url: string };

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
      view.webview.onDidReceiveMessage((message: ReviewViewMessage) => {
        log(`[review-view] message received type=${message.type}`);
        void this.handleMessage(message);
      }),
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
    if (message.type === "openCheck") {
      const uri = vscode.Uri.parse(message.url);
      if (uri.scheme !== "http" && uri.scheme !== "https") {
        vscode.window.showWarningMessage("Unsupported check URL.");
        return;
      }
      log(`[review-view] opening check url=${message.url}`);
      await vscode.env.openExternal(uri);
      return;
    }

    if (this.busy) {
      log(`[review-view] ignored type=${message.type}; busy=true`);
      return;
    }

    const active = this.activeContext();
    if (!active) {
      log(`[review-view] ignored type=${message.type}; no active PR`);
      vscode.window.showWarningMessage(
        "No active Gitea pull request is available for review.",
      );
      return;
    }

    if (message.type === "readyForReview") {
      await this.markReadyForReview(active.repoInfo, active.state);
      return;
    }

    if (message.type === "selectMergeMethod") {
      const supported = supportedMergeMethods(this.readiness.mergeSettings);
      if (supported.includes(message.method)) {
        await this.workspaceState.update(MERGE_METHOD_STATE_KEY, message.method);
        log(`[review-view] merge method selected=${message.method}`);
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
        log(`[review-view] posting comment pr=#${number}`);
        await this.reviewApi.addComment(active.repoInfo, number, body);
        vscode.window.showInformationMessage(`Comment posted on PR #${number}.`);
      } else if (message.type === "approve") {
        log(`[review-view] approving pr=#${number}`);
        await this.reviewApi.createReview(
          active.repoInfo,
          number,
          "APPROVED",
          body,
        );
        vscode.window.showInformationMessage(`PR #${number} approved.`);
      } else {
        log(`[review-view] requesting changes pr=#${number}`);
        await this.reviewApi.createReview(
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
      log(`[review-view] action type=${message.type} failed: ${(error as Error).message}`);
      vscode.window.showErrorMessage(
        `Unable to update PR #${number}: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async markReadyForReview(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
  ): Promise<void> {
    if (!isWorkInProgress(state.pullRequest)) return;
    const title = readyForReviewTitle(state.pullRequest.title);
    if (!title) {
      vscode.window.showWarningMessage(
        "The pull request title would be empty after removing the WIP marker.",
      );
      return;
    }

    this.busy = true;
    this.render();
    try {
      log(`[review-view] marking ready pr=#${state.pullRequest.number}`);
      const pullRequest = await this.api.updatePullRequest(
        repoInfo,
        state.pullRequest.number,
        { title },
      );
      await this.session.activate(state.repository, pullRequest, state.checkoutState);
      this.prProvider.refresh();
      const refreshed = this.activeContext();
      if (refreshed) await this.loadReadiness(refreshed.repoInfo, refreshed.state);
      vscode.window.showInformationMessage(
        `PR #${state.pullRequest.number} marked ready for review.`,
      );
    } catch (error) {
      log(`[review-view] ready-for-review failed: ${(error as Error).message}`);
      vscode.window.showErrorMessage(
        `Unable to mark PR #${state.pullRequest.number} ready for review: ${(error as Error).message}`,
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
      log(`[review-view] refreshing PR repo=${repoInfo.label} pr=#${state.pullRequest.number}`);
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
      log(`[review-view] refreshed PR repo=${repoInfo.label} pr=#${pullRequest.number}`);
    } catch (error) {
      log(`[review-view] PR refresh failed: ${(error as Error).message}`);
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
    if (this.readiness.loading && this.readiness.identity === identity) {
      log(`[review-view] readiness already loading identity=${identity}`);
      return;
    }

    this.readiness = { loading: true, identity };
    log(`[review-view] readiness start identity=${identity}`);
    this.render();

    const [status, reviews, mergeSettings, branchPolicy] = await Promise.allSettled([
      this.reviewApi.getCombinedStatus(repoInfo, state.pullRequest.head.sha),
      this.reviewApi.listReviews(repoInfo, state.pullRequest.number),
      this.reviewApi.getRepositoryMergeSettings(repoInfo),
      this.reviewApi.getBranchMergePolicy(repoInfo, state.pullRequest.base.ref),
    ]);

    const current = this.activeContext();
    if (
      !current ||
      `${current.repoInfo.key}#${current.state.pullRequest.number}@${current.state.pullRequest.head.sha}` !== identity
    ) {
      log(`[review-view] readiness discarded stale identity=${identity}`);
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
    log(
      `[review-view] readiness complete identity=${identity} status=${status.status} reviews=${reviews.status} settings=${mergeSettings.status} branch=${branchPolicy.status}`,
    );
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

      log(`[review-view] merge start pr=#${latestPr.number} method=${method}`);
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
      log(`[review-view] merge complete pr=#${latestPr.number} method=${method}`);
      vscode.window.showInformationMessage(
        `PR #${latestPr.number} merged using ${mergeMethodLabel(method)}.`,
      );
    } catch (error) {
      log(`[review-view] merge failed: ${(error as Error).message}`);
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

    return {
      localBranchExists: repository.state.refs.some(
        (ref) => ref.name === branch && !ref.remote,
      ),
      remoteBranchExists: repository.state.refs.some(
        (ref) =>
          ref.name === `origin/${branch}` ||
          (ref.remote === "origin" && ref.name === branch),
      ),
    };
  }

  private async gitRepository(
    repoInfo: RepoInfo,
    showErrors = true,
  ): Promise<GitRepositoryLike | undefined> {
    const gitExt = vscode.extensions.getExtension<GitExtensionExportsLike>("vscode.git");
    if (!gitExt) {
      if (showErrors) vscode.window.showErrorMessage("Git extension not available.");
      return undefined;
    }

    const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
    const repository = git
      .getAPI(1)
      .repositories.find((repo) => repo.rootUri.fsPath === repoInfo.rootPath);
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
    const wip = isWorkInProgress(pr);
    const noChanges = hasNoChangesToMerge(pr);
    const mergeable = wip
      ? "Draft / WIP"
      : noChanges
        ? "No changes to merge"
        : pr.mergeable === true
          ? "Mergeable"
          : pr.mergeable === false
            ? "Not mergeable (Gitea)"
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
    const statuses = this.readiness.status?.statuses ?? [];
    const successfulChecks = statuses.filter((status) => status.state === "success").length;
    const pendingChecks = statuses.filter((status) => status.state === "pending").length;
    const failedChecks = statuses.filter(
      (status) => status.state === "failure" || status.state === "error",
    ).length;
    const warningChecks = statuses.filter((status) => status.state === "warning").length;
    const checkSummary = statuses.length > 0
      ? `${successfulChecks} successful · ${pendingChecks} pending · ${failedChecks} failed${warningChecks ? ` · ${warningChecks} warning` : ""}`
      : "No commit status checks reported";
    const checks = statuses
      .map((status) => {
        const label = escapeHtml(status.context || "check");
        const description = status.description
          ? `<div class="check-description">${escapeHtml(status.description)}</div>`
          : "";
        const name = status.target_url
          ? `<a href="#" data-check-url="${escapeHtml(status.target_url)}" title="Open check in Gitea">${label}</a>`
          : label;
        return `<li class="check check-${status.state}">
          <span class="check-state">${escapeHtml(checkStateLabel(status.state))}</span>
          <span class="check-content"><span class="check-name">${name}</span>${description}</span>
        </li>`;
      })
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
  .checks { list-style: none; padding: 0; margin-top: 8px; }
  .check { display: grid; grid-template-columns: max-content 1fr; gap: 8px; align-items: start; padding: 6px 0; border-top: 1px solid var(--vscode-panel-border); }
  .check:first-child { border-top: 0; }
  .check-state { min-width: 62px; font-size: 0.9em; font-weight: 600; }
  .check-success .check-state { color: var(--vscode-testing-iconPassed); }
  .check-pending .check-state, .check-warning .check-state { color: var(--vscode-editorWarning-foreground); }
  .check-failure .check-state, .check-error .check-state { color: var(--vscode-errorForeground); }
  .check-name { overflow-wrap: anywhere; }
  .check-description { color: var(--vscode-descriptionForeground); margin-top: 2px; overflow-wrap: anywhere; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="header">
    <div class="title">#${pr.number} ${escapeHtml(pr.title)}</div>
    <div class="meta">${escapeHtml(active.repoInfo.label)} · ${escapeHtml(pr.head.ref)} → ${escapeHtml(pr.base.ref)}</div>
  </div>

  <div class="section-title">Review</div>
  <textarea id="reviewBody" placeholder="Leave a comment or review message">${escapeHtml(this.reviewBody)}</textarea>
  <div class="actions">
    <button id="comment"${disabled}>Comment</button>
    <button class="secondary" id="approve"${disabled}>Approve</button>
    <button class="danger" id="requestChanges"${disabled}>Request Changes</button>
    ${wip ? `<button class="secondary" id="readyForReview"${disabled}>Mark Ready for Review</button>` : ""}
  </div>

  <div class="section">
    <div class="section-title">Merge readiness</div>
    <div>${stateLabel} · ${mergeable}</div>
    <div>${escapeHtml(readiness.reviewLabel)} · ${escapeHtml(readiness.ciLabel)}</div>
    ${this.readiness.loading ? '<div class="muted">Refreshing merge readiness…</div>' : ""}
    ${blockers ? `<ul class="blocked">${blockers}</ul>` : '<div class="ready">No blocking condition detected from available Gitea signals.</div>'}
    ${warnings ? `<ul class="muted">${warnings}</ul>` : ""}
    ${this.readiness.warning ? `<div class="muted">Some readiness metadata is unavailable: ${escapeHtml(this.readiness.warning)}</div>` : ""}
  </div>

  <div class="section">
    <div class="section-title">Checks</div>
    <div class="muted">${escapeHtml(checkSummary)}</div>
    ${checks ? `<ul class="checks">${checks}</ul>` : ""}
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
  document.getElementById('readyForReview')?.addEventListener('click', () => vscode.postMessage({ type: 'readyForReview' }));
  document.querySelectorAll('[data-check-url]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    vscode.postMessage({ type: 'openCheck', url: link.dataset.checkUrl });
  }));
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

function checkStateLabel(state: string): string {
  switch (state) {
    case "success":
      return "Success";
    case "pending":
      return "Pending";
    case "warning":
      return "Warning";
    case "failure":
      return "Failed";
    case "error":
      return "Error";
    default:
      return state;
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
