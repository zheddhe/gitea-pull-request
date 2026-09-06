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
import {
  externalCheckPresentation,
  extractGiteaRunId,
} from "../../ci/domain/ciPresentation";
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
import { visibilityRefreshDecision } from "../domain/visibilityRefreshPolicy";
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
  branches?: string[];
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
  | { type: "approve"; body: string }
  | { type: "requestChanges"; body: string }
  | { type: "draftChanged"; body: string }
  | { type: "readyForReview" }
  | { type: "selectMergeMethod"; method: MergeMethod }
  | { type: "merge" }
  | { type: "closePR" }
  | { type: "checkoutSource" }
  | { type: "checkoutBase" }
  | { type: "updateBase"; base: string }
  | { type: "openCheck"; url: string }
  | { type: "rerunCheck"; runId: number }
  | { type: "cancelCheck"; runId: number };

const MERGE_METHOD_STATE_KEY = "gitea.prReview.mergeMethod";
const ACCELERATE_READINESS_POLLING_COMMAND =
  "gitea.internal.accelerateReadinessPolling";

export class ReviewPullRequestViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.reviewPullRequest";

  private view: vscode.WebviewView | undefined;
  private reviewBody = "";
  private busy = false;
  private readiness: ReadinessState = { loading: false };
  private activePullRequestIdentity: string | undefined;
  private visibilityRefreshInFlight = false;
  private lastVisibilityRefreshAt = 0;
  private deferredVisibilityRefresh = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly reviewApi: PullRequestReviewApi,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly prProvider: PullRequestProvider,
    private readonly workspaceState: vscode.Memento,
  ) {
    this.activePullRequestIdentity = this.pullRequestIdentity(this.session.current);
    this.disposables.push(
      this.session.onDidChangeState((state) => {
        const nextIdentity = this.pullRequestIdentity(state);
        if (nextIdentity !== this.activePullRequestIdentity) {
          this.reviewBody = "";
        }
        this.activePullRequestIdentity = nextIdentity;
        this.readiness = { loading: false };
        this.render();
        if (state.kind === "active") {
          const repoInfo = this.repoManager
            .getRepos()
            .find((repo) => repo.key === state.repository.key);
          if (repoInfo) void this.loadReadiness(repoInfo, state);
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
        if (message.type !== "draftChanged") {
          log(`[review-view] message received type=${message.type}`);
        }
        void this.handleMessage(message);
      }),
      view.onDidChangeVisibility(() => {
        if (view.visible) void this.refreshOnVisibility();
      }),
    );
    this.render();
    const active = this.activeContext();
    if (active) void this.loadReadiness(active.repoInfo, active.state);
    if (view.visible) this.lastVisibilityRefreshAt = Date.now();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private pullRequestIdentity(
    state: PullRequestWorkspaceState,
  ): string | undefined {
    return state.kind === "active"
      ? `${state.repository.key}#${state.pullRequest.number}`
      : undefined;
  }

  private activeContext():
    | { repoInfo: RepoInfo; state: ActivePullRequestState }
    | undefined {
    const state = this.session.current;
    if (state.kind !== "active") return undefined;
    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    return repoInfo ? { repoInfo, state } : undefined;
  }

  private async refreshOnVisibility(ignoreCooldown = false): Promise<void> {
    const view = this.view;
    const active = this.activeContext();
    if (!view || !active) return;

    const now = Date.now();
    const decision = visibilityRefreshDecision({
      visible: view.visible,
      busy: this.busy,
      hasDraft: this.reviewBody.length > 0,
      inFlight: this.visibilityRefreshInFlight,
      lastRefreshAt: ignoreCooldown ? 0 : this.lastVisibilityRefreshAt,
      now,
    });

    if (decision === "draft" || decision === "busy") {
      this.deferredVisibilityRefresh = true;
      log(
        `[review-view] visibility refresh deferred reason=${decision} repo=${active.repoInfo.label} pr=#${active.state.pullRequest.number}`,
      );
      return;
    }
    if (decision !== "refresh") return;

    this.visibilityRefreshInFlight = true;
    this.deferredVisibilityRefresh = false;
    this.lastVisibilityRefreshAt = now;
    const repositoryKey = active.state.repository.key;
    const pullRequestNumber = active.state.pullRequest.number;
    log(
      `[review-view] visibility refresh repo=${active.repoInfo.label} pr=#${pullRequestNumber}`,
    );

    try {
      const pullRequest = await this.api.getPullRequest(
        active.repoInfo,
        pullRequestNumber,
      );
      const current = this.activeContext();
      if (
        !current ||
        current.state.repository.key !== repositoryKey ||
        current.state.pullRequest.number !== pullRequestNumber
      ) {
        return;
      }
      await this.session.activate(
        current.state.repository,
        pullRequest,
        current.state.checkoutState,
      );
      this.prProvider.refresh();
      log(
        `[review-view] visibility refresh complete repo=${current.repoInfo.label} pr=#${pullRequest.number} head=${pullRequest.head.sha}`,
      );
    } catch (error) {
      log(
        `[review-view] visibility refresh failed repo=${active.repoInfo.label} pr=#${pullRequestNumber}: ${(error as Error).message}`,
      );
    } finally {
      this.visibilityRefreshInFlight = false;
    }
  }

  private async handleMessage(message: ReviewViewMessage): Promise<void> {
    if (message.type === "draftChanged") {
      this.reviewBody = message.body;
      if (
        !this.reviewBody &&
        this.deferredVisibilityRefresh &&
        this.view?.visible
      ) {
        void this.refreshOnVisibility(true);
      }
      return;
    }

    if (message.type === "openCheck") {
      const uri = vscode.Uri.parse(message.url);
      if (uri.scheme !== "http" && uri.scheme !== "https") {
        vscode.window.showWarningMessage("Unsupported check URL.");
        return;
      }
      await vscode.env.openExternal(uri);
      return;
    }

    if (this.busy) return;
    const active = this.activeContext();
    if (!active) {
      vscode.window.showWarningMessage(
        "No active Gitea pull request is available for review.",
      );
      return;
    }

    if (message.type === "rerunCheck" || message.type === "cancelCheck") {
      const runId = Number(message.runId);
      if (!Number.isSafeInteger(runId) || runId <= 0) {
        vscode.window.showWarningMessage("Invalid Gitea Actions run identifier.");
        return;
      }
      this.busy = true;
      this.render();
      try {
        if (message.type === "rerunCheck") {
          await this.api.rerunWorkflow(active.repoInfo, runId);
          vscode.window.showInformationMessage(`Re-run triggered for Actions run #${runId}.`);
        } else {
          await this.api.cancelWorkflowRun(active.repoInfo, runId);
          vscode.window.showInformationMessage(`Cancellation requested for Actions run #${runId}.`);
        }
        await vscode.commands.executeCommand(ACCELERATE_READINESS_POLLING_COMMAND);
      } catch (error) {
        vscode.window.showErrorMessage(
          `${message.type === "rerunCheck" ? "Re-run" : "Cancel"} failed: ${(error as Error).message}`,
        );
      } finally {
        this.busy = false;
        this.render();
      }
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
        this.render();
      }
      return;
    }
    if (message.type === "merge") {
      await this.merge(active.repoInfo, active.state);
      return;
    }
    if (message.type === "closePR") {
      await this.closePullRequest(active.repoInfo, active.state);
      return;
    }
    if (message.type === "checkoutSource") {
      await this.checkoutBranch(active.repoInfo, active.state, "source");
      return;
    }
    if (message.type === "checkoutBase") {
      await this.checkoutBranch(active.repoInfo, active.state, "base");
      return;
    }
    if (message.type === "updateBase") {
      await this.updateBase(active.repoInfo, active.state, message.base);
      return;
    }

    this.reviewBody = message.body;
    const body = message.body.trim();
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
      if (message.type === "approve") {
        await this.reviewApi.createReview(active.repoInfo, number, "APPROVED", body);
        vscode.window.showInformationMessage(`PR #${number} approved.`);
      } else {
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
      const pullRequest = await this.api.updatePullRequest(
        repoInfo,
        state.pullRequest.number,
        { title },
      );
      await this.session.activate(state.repository, pullRequest, state.checkoutState);
      this.prProvider.refresh();
      const refreshed = this.activeContext();
      if (refreshed) await this.loadReadiness(refreshed.repoInfo, refreshed.state);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to mark PR #${state.pullRequest.number} ready for review: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async updateBase(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
    base: string,
  ): Promise<void> {
    if (!base || base === state.pullRequest.base.ref) return;
    this.busy = true;
    this.render();
    try {
      const pullRequest = await this.api.updatePullRequest(
        repoInfo,
        state.pullRequest.number,
        { base },
      );
      await this.session.activate(state.repository, pullRequest, state.checkoutState);
      this.prProvider.refresh();
      this.readiness = { loading: false };
      const refreshed = this.activeContext();
      if (refreshed) await this.loadReadiness(refreshed.repoInfo, refreshed.state);
      vscode.window.showInformationMessage(
        `PR #${pullRequest.number} base branch changed to ${base}.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to change base branch: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async refreshActivePullRequest(repoInfo: RepoInfo): Promise<void> {
    const state = this.session.current;
    if (state.kind !== "active" || state.repository.key !== repoInfo.key) return;
    const pullRequest = await this.api.getPullRequest(
      repoInfo,
      state.pullRequest.number,
    );
    await this.session.activate(state.repository, pullRequest, state.checkoutState);
    this.prProvider.refresh();
  }

  private async loadReadiness(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
  ): Promise<void> {
    const identity = `${repoInfo.key}#${state.pullRequest.number}@${state.pullRequest.head.sha}`;
    if (this.readiness.loading && this.readiness.identity === identity) return;
    this.readiness = { loading: true, identity };
    this.render();

    const [status, reviews, mergeSettings, branchPolicy, branches] =
      await Promise.allSettled([
        this.reviewApi.getCombinedStatus(repoInfo, state.pullRequest.head.sha),
        this.reviewApi.listReviews(repoInfo, state.pullRequest.number),
        this.reviewApi.getRepositoryMergeSettings(repoInfo),
        this.reviewApi.getBranchMergePolicy(repoInfo, state.pullRequest.base.ref),
        this.api.listBranches(repoInfo),
      ]);

    const current = this.activeContext();
    if (
      !current ||
      `${current.repoInfo.key}#${current.state.pullRequest.number}@${current.state.pullRequest.head.sha}` !== identity
    ) {
      return;
    }

    const warnings = [status, reviews, mergeSettings, branchPolicy, branches]
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
      branches: branches.status === "fulfilled" ? branches.value : undefined,
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
        "Merge PR",
      );
      if (confirm !== "Merge PR") return;
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
      vscode.window.showInformationMessage(`PR #${latestPr.number} merged.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Merge failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async closePullRequest(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
  ): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Close PR #${state.pullRequest.number} without merging?`,
      { modal: true },
      "Close PR",
    );
    if (confirm !== "Close PR") return;
    this.busy = true;
    this.render();
    try {
      const closed = await this.api.closePullRequest(
        repoInfo,
        state.pullRequest.number,
      );
      await this.session.activate(state.repository, closed, state.checkoutState);
      this.prProvider.refresh();
      vscode.window.showInformationMessage(`PR #${closed.number} closed.`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to close PR #${state.pullRequest.number}: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async checkoutBranch(
    repoInfo: RepoInfo,
    state: ActivePullRequestState,
    target: "source" | "base",
  ): Promise<void> {
    const branch =
      target === "source" ? state.pullRequest.head.ref : state.pullRequest.base.ref;
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
      await this.session.setCheckoutState(
        target === "source"
          ? { kind: "checkedOut", localBranch: branch }
          : { kind: "notCheckedOut" },
      );
      vscode.window.showInformationMessage(
        `Checked out ${target} branch: ${branch}`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to checkout ${target} branch: ${(error as Error).message}`,
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
      // Best effort.
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
    const gitExt = vscode.extensions.getExtension<GitExtensionExportsLike>(
      "vscode.git",
    );
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
    if (!this.view) return;
    const active = this.activeContext();
    if (!active) {
      this.view.webview.html = this.emptyHtml();
      return;
    }

    const pr = active.state.pullRequest;
    this.view.title = `Review Pull Request #${pr.number} (${active.repoInfo.label})`;
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
    const readiness = this.readiness.loading
      ? undefined
      : this.currentReadiness(active.state);
    const supported = supportedMergeMethods(this.readiness.mergeSettings);
    const selected = this.selectedMergeMethod();
    const mergeDisabled =
      this.busy || this.readiness.loading || !readiness?.canMerge || !selected;
    const methodOptions = supported
      .map(
        (method) =>
          `<option value="${method}"${method === selected ? " selected" : ""}>${escapeHtml(mergeMethodLabel(method))}</option>`,
      )
      .join("");
    const branchOptions = (this.readiness.branches ?? [pr.base.ref])
      .filter((branch) => branch !== pr.head.ref)
      .map(
        (branch) =>
          `<option value="${escapeHtml(branch)}"${branch === pr.base.ref ? " selected" : ""}>${escapeHtml(branch)}</option>`,
      )
      .join("");
    const blockers = readiness
      ? readiness.blockingReasons
          .map((reason) => `<li>${escapeHtml(reason)}</li>`)
          .join("")
      : "";
    const warnings = readiness
      ? readiness.warnings
          .map((warning) => `<li>${escapeHtml(warning)}</li>`)
          .join("")
      : "";
    const statuses = this.readiness.status?.statuses ?? [];
    const presentations = statuses.map((status) => ({
      status,
      presentation: externalCheckPresentation(status.state, status.target_url),
      runId: extractGiteaRunId(status.target_url),
    }));
    const successfulChecks = presentations.filter(
      (item) => item.presentation.state === "success",
    ).length;
    const pendingChecks = presentations.filter(
      (item) =>
        item.presentation.state === "running" ||
        item.presentation.state === "queued",
    ).length;
    const failedChecks = presentations.filter(
      (item) => item.presentation.state === "failure",
    ).length;
    const warningChecks = presentations.filter(
      (item) => item.presentation.state === "warning",
    ).length;
    const checkSummary =
      statuses.length > 0
        ? `${successfulChecks} successful · ${pendingChecks} pending · ${failedChecks} failed${warningChecks ? ` · ${warningChecks} warning` : ""}`
        : "No commit status checks reported";

    const actionIcon = (path: string) =>
      `<svg class="ci-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
    const openIcon = actionIcon(
      "M9 2h5v5h-1V3.7L7.35 9.35l-.7-.7L12.3 3H9V2zM3 4h4v1H4v7h7V8h1v5H3V4z",
    );
    const rerunIcon = actionIcon(
      "M13.2 3.8A6 6 0 1 0 14 9h-1.2a4.8 4.8 0 1 1-.7-4.3L10 6h5V1l-1.8 2.8z",
    );
    const cancelIcon = actionIcon(
      "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM5 5h6v6H5V5z",
    );
    const checks = presentations
      .map(({ status, presentation, runId }) => {
        const label = escapeHtml(status.context || "check");
        const description = status.description
          ? `<div class="check-description">${escapeHtml(status.description)}</div>`
          : "";
        const actions = [
          presentation.actions.openInBrowser && status.target_url
            ? `<button class="ci-check-action" data-check-open="${escapeHtml(status.target_url)}" title="Open in browser" aria-label="Open ${label} in browser">${openIcon}</button>`
            : "",
          presentation.actions.rerun && runId
            ? `<button class="ci-check-action" data-check-rerun="${runId}" title="Re-run workflow" aria-label="Re-run ${label}">${rerunIcon}</button>`
            : "",
          presentation.actions.cancel && runId
            ? `<button class="ci-check-action" data-check-cancel="${runId}" title="Cancel workflow" aria-label="Cancel ${label}">${cancelIcon}</button>`
            : "",
        ].join("");
        return `<li class="check"><span class="ci-status-dot ci-state-${presentation.state}" title="${escapeHtml(presentation.statusLabel)}" aria-label="${escapeHtml(presentation.statusLabel)}"></span><div class="check-main"><div class="check-line"><span class="check-name">${label}</span><span class="check-status muted">${escapeHtml(presentation.statusLabel)}</span></div>${description}</div><div class="check-actions">${actions}</div></li>`;
      })
      .join("");
    const readinessHtml = this.readiness.loading
      ? '<div class="muted">Refreshing merge readiness…</div>'
      : readiness
        ? `<div>${stateLabel} · ${mergeable}</div>
    <div class="muted">${escapeHtml(readiness.reviewLabel)} · ${escapeHtml(readiness.ciLabel)}</div>
    ${blockers ? `<ul class="blocked">${blockers}</ul>` : '<div class="ready">No blocking condition detected from available Gitea signals.</div>'}
    ${warnings ? `<ul class="muted">${warnings}</ul>` : ""}`
        : '<div class="muted">Merge readiness unavailable.</div>';

    const icon = (path: string) =>
      `<svg class="section-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;
    const branchIcon = icon("M5 3.5A2.5 2.5 0 1 1 3 1v8a3 3 0 0 0 3 3h2.5a2.5 2.5 0 1 1 0 1H6a4 4 0 0 1-4-4V5.45A2.5 2.5 0 0 1 5 3.5zM3.5 2A1.5 1.5 0 1 0 3.5 5a1.5 1.5 0 0 0 0-3zm7 9A1.5 1.5 0 1 0 10.5 14a1.5 1.5 0 0 0 0-3z");
    const readinessIcon = icon("M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1a6 6 0 1 1 0 12A6 6 0 0 1 8 2zm3.85 3.15-.7-.7L7 8.6 4.85 6.45l-.7.7L7 10l4.85-4.85z");
    const checksIcon = icon("M6.5 11.5 3 8l.7-.7 2.8 2.8 5.8-5.8.7.7-6.5 6.5z");
    const reviewIcon = icon("M2 2h12v9H7.2L4 13.7V11H2V2zm1 1v7h2v1.55L6.8 10H13V3H3z");
    const actionsIcon = icon("M6 3.5 11 8l-5 4.5v-9z");
    const checkoutIcon = icon("M8 1v8.1l2.55-2.55.7.7L7.5 11 3.75 7.25l.7-.7L7 9.1V1h1zm-5 11h9v1H3v-1z");

    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{padding:12px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
  .muted{color:var(--vscode-descriptionForeground)}
  textarea,select{box-sizing:border-box;width:100%;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);padding:6px 8px}
  textarea{min-height:110px;resize:vertical}
  .section{margin-top:14px;padding-top:10px;border-top:1px solid var(--vscode-panel-border)}
  .section:first-child{margin-top:0;padding-top:0;border-top:0}
  .section-title{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:7px}
  .section-icon{width:15px;height:15px;flex:0 0 15px;color:var(--vscode-descriptionForeground)}
  .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  button{font:inherit;border:1px solid transparent;padding:6px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}
  button.success-outline{color:var(--vscode-testing-iconPassed);background:var(--vscode-button-secondaryBackground);border-color:var(--vscode-testing-iconPassed)}
  button.danger-outline{color:var(--vscode-errorForeground);background:var(--vscode-button-secondaryBackground);border-color:var(--vscode-errorForeground)}
  button.icon-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;padding:3px;color:var(--vscode-foreground);background:var(--vscode-button-secondaryBackground);border-color:var(--vscode-widget-border,var(--vscode-panel-border))}
  button.icon-button .section-icon{color:currentColor}
  button:disabled,select:disabled{opacity:.55;cursor:default}
  .branch-grid{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;gap:7px 8px;align-items:center}
  .branch-grid strong{white-space:nowrap}
  ul{margin:6px 0;padding-left:20px}.blocked{color:var(--vscode-errorForeground)}.ready{color:var(--vscode-testing-iconPassed)}
  .checks{list-style:none;padding:0;margin-top:8px}.check{display:grid;grid-template-columns:12px minmax(0,1fr) max-content;gap:8px;align-items:start;padding:7px 0;border-top:1px solid var(--vscode-panel-border)}.check:first-child{border-top:0}.ci-status-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;background:var(--vscode-descriptionForeground)}.ci-state-success{background:var(--vscode-testing-iconPassed,var(--vscode-charts-green))}.ci-state-running{background:var(--vscode-charts-orange,var(--vscode-editorWarning-foreground))}.ci-state-queued{background:var(--vscode-testing-iconQueued,var(--vscode-charts-yellow))}.ci-state-warning{background:var(--vscode-editorWarning-foreground,var(--vscode-charts-yellow))}.ci-state-failure{background:var(--vscode-testing-iconFailed,var(--vscode-errorForeground))}.ci-state-cancelled{background:var(--vscode-disabledForeground,var(--vscode-descriptionForeground))}.ci-state-skipped{background:var(--vscode-testing-iconSkipped,var(--vscode-descriptionForeground))}.ci-state-unknown{background:var(--vscode-descriptionForeground)}.check-main{min-width:0}.check-line{display:flex;align-items:baseline;gap:7px;min-width:0}.check-name{font-weight:500;overflow-wrap:anywhere}.check-status{font-size:.9em;white-space:nowrap}.check-description{color:var(--vscode-descriptionForeground);margin-top:2px;overflow-wrap:anywhere}.check-actions{display:flex;gap:2px;align-items:center}.ci-check-action{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:2px;border:0;border-radius:3px;background:transparent;color:var(--vscode-descriptionForeground)}.ci-check-action:hover{color:var(--vscode-foreground);background:var(--vscode-toolbar-hoverBackground)}.ci-action-icon{width:14px;height:14px}a{color:var(--vscode-textLink-foreground);text-decoration:none}
</style>
</head>
<body>
  <div class="section">
    <div class="section-title">${branchIcon}<span>Branch identification</span></div>
    <div class="branch-grid">
      <strong>Source branch</strong><select aria-label="Source branch" disabled><option selected>${escapeHtml(pr.head.ref)}</option></select><button class="icon-button" id="checkoutSource" title="Checkout source branch" aria-label="Checkout source branch">${checkoutIcon}</button>
      <strong>Base branch</strong><select id="baseBranch" aria-label="Base branch"${this.busy ? " disabled" : ""}>${branchOptions}</select><button class="icon-button" id="checkoutBase" title="Checkout base branch" aria-label="Checkout base branch">${checkoutIcon}</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">${reviewIcon}<span>Review</span></div>
    <textarea id="reviewBody" placeholder="Leave a review message">${escapeHtml(this.reviewBody)}</textarea>
    <div class="actions">
      <button class="success-outline" id="approve"${disabled}>Approve</button>
      <button class="danger-outline" id="requestChanges"${disabled}>Request Changes</button>
      ${wip ? `<button id="readyForReview"${disabled}>Mark Ready for Review</button>` : ""}
    </div>
  </div>

  <div class="section">
    <div class="section-title">${checksIcon}<span>Checks</span></div>
    <div class="muted">${escapeHtml(checkSummary)}</div>
    ${checks ? `<ul class="checks">${checks}</ul>` : ""}
  </div>

  <div class="section">
    <div class="section-title">${readinessIcon}<span>Merge readiness</span></div>
    ${readinessHtml}
  </div>

  <div class="section">
    <div class="section-title">${actionsIcon}<span>Actions</span></div>
    <select id="mergeMethod"${this.busy || supported.length === 0 ? " disabled" : ""}>${methodOptions}</select>
    <div class="actions">
      <button id="merge"${mergeDisabled ? " disabled" : ""}>Merge PR</button>
      ${pr.state === "open" && !pr.merged ? `<button class="danger-outline" id="closePR"${disabled}>Close PR</button>` : ""}
    </div>
  </div>
<script>
  const vscode=acquireVsCodeApi();
  const body=document.getElementById('reviewBody');
  const mergeMethod=document.getElementById('mergeMethod');
  const baseBranch=document.getElementById('baseBranch');
  const persistedState=vscode.getState() || {};
  if (Number.isFinite(persistedState.scrollY)) {
    requestAnimationFrame(()=>window.scrollTo(0,persistedState.scrollY));
  }
  let scrollFramePending=false;
  window.addEventListener('scroll',()=>{
    if (scrollFramePending) return;
    scrollFramePending=true;
    requestAnimationFrame(()=>{
      scrollFramePending=false;
      vscode.setState({...vscode.getState(),scrollY:window.scrollY});
    });
  });
  body?.addEventListener('input',()=>vscode.postMessage({type:'draftChanged',body:body.value}));
  document.getElementById('approve')?.addEventListener('click',()=>vscode.postMessage({type:'approve',body:body.value}));
  document.getElementById('requestChanges')?.addEventListener('click',()=>vscode.postMessage({type:'requestChanges',body:body.value}));
  document.getElementById('readyForReview')?.addEventListener('click',()=>vscode.postMessage({type:'readyForReview'}));
  document.querySelectorAll('[data-check-open]').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({type:'openCheck',url:button.dataset.checkOpen})));
  document.querySelectorAll('[data-check-rerun]').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({type:'rerunCheck',runId:Number(button.dataset.checkRerun)})));
  document.querySelectorAll('[data-check-cancel]').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({type:'cancelCheck',runId:Number(button.dataset.checkCancel)})));
  mergeMethod?.addEventListener('change',()=>vscode.postMessage({type:'selectMergeMethod',method:mergeMethod.value}));
  baseBranch?.addEventListener('change',()=>vscode.postMessage({type:'updateBase',base:baseBranch.value}));
  document.getElementById('merge')?.addEventListener('click',()=>vscode.postMessage({type:'merge'}));
  document.getElementById('closePR')?.addEventListener('click',()=>vscode.postMessage({type:'closePR'}));
  document.getElementById('checkoutSource')?.addEventListener('click',()=>vscode.postMessage({type:'checkoutSource'}));
  document.getElementById('checkoutBase')?.addEventListener('click',()=>vscode.postMessage({type:'checkoutBase'}));
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
    .split(String.fromCharCode(34))
    .join("&quot;")
    .replace(/'/g, "&#039;");
}