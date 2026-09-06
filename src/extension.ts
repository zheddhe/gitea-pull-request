import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { PullRequestMetadataApi } from "./api/pullRequestMetadataApi";
import { RepositoryMetadataApi } from "./api/repositoryMetadataApi";
import { RepoManager } from "./context/repoManager";
import { CIRunsProvider } from "./views/ciRunsProvider";
import { IssuesProvider } from "./views/issuesProvider";
import { PRDetailPanel } from "./views/prDetailPanel";
import { StatusBarManager } from "./ui/statusBar";
import { registerPRCommands } from "./commands/prCommands";
import { registerCICommands } from "./commands/ciCommands";
import { registerAuthCommands } from "./commands/authCommands";
import { registerIssueCommands } from "./commands/issueCommands";
import { initOutputChannel } from "./debug/outputChannel";
import { IssueCreationSessionService } from "./features/issues/services/issueCreationSessionService";
import { IssueTemplateService } from "./features/issues/services/issueTemplateService";
import { CreateIssueViewProvider } from "./features/issues/views/createIssueView";
import { ActivePullRequestPollingService } from "./features/polling/services/activePullRequestPollingService";
import { CIRunsPollingService } from "./features/polling/services/ciRunsPollingService";
import { PollingLifecycleSignalService } from "./features/polling/services/pollingLifecycleSignalService";
import {
  PollingScheduler,
  type PollingClock,
} from "./features/polling/services/pollingScheduler";
import { PollingVisibilityTreeViewTracker } from "./features/polling/services/pollingVisibilityTreeViewTracker";
import { PollingVisibilityWebviewProvider } from "./features/polling/services/pollingVisibilityWebviewProvider";
import { registerConflictResolutionCommands } from "./features/pullRequests/commands/conflictResolutionCommands";
import { registerPullRequestSessionCommands } from "./features/pullRequests/commands/sessionCommands";
import { registerRefreshActivePullRequestCommand } from "./features/pullRequests/commands/refreshActivePullRequestCommand";
import { registerWorkingFileCommands } from "./features/pullRequests/commands/workingFileCommands";
import type {
  PendingConversationAction,
  PendingInlineComment,
  PendingReviewReply,
  PendingReviewSession,
} from "./features/pullRequests/domain/pendingReviewSession";
import { BranchCleanupService } from "./features/pullRequests/services/branchCleanupService";
import { ConflictResolutionCoordinator } from "./features/pullRequests/services/conflictResolutionCoordinator";
import { ConflictResolutionService } from "./features/pullRequests/services/conflictResolutionService";
import { NativeReviewProjectionService } from "./features/pullRequests/services/nativeReviewProjectionService";
import {
  createPullRequestConversationApiView,
  PullRequestConversationService,
} from "./features/pullRequests/services/pullRequestConversationService";
import { PullRequestSessionCoordinator } from "./features/pullRequests/services/pullRequestSessionCoordinator";
import { PullRequestSessionService } from "./features/pullRequests/services/pullRequestSessionService";
import { PullRequestReviewApi } from "./features/pullRequests/services/pullRequestReviewApi";
import { PullRequestReviewSessionService } from "./features/pullRequests/services/pullRequestReviewSessionService";
import { ResilientGiteaApiClient } from "./features/pullRequests/services/resilientGiteaApiClient";
import { ReviewNavigationSignalService } from "./features/pullRequests/services/reviewNavigationSignalService";
import { ReviewedFileStateService } from "./features/pullRequests/services/reviewedFileStateService";
import {
  PULL_REQUEST_SNAPSHOT_SCHEME,
  PullRequestSnapshotDocumentProvider,
} from "./features/pullRequests/services/pullRequestSnapshotDocumentProvider";
import { WorkingFileBridgeService } from "./features/pullRequests/services/workingFileBridgeService";
import { CreatePullRequestViewProvider } from "./features/pullRequests/views/createPullRequestView";
import { PostMergePullRequestViewProvider } from "./features/pullRequests/views/postMergePullRequestView";
import { ReviewPullRequestViewProvider } from "./features/pullRequests/views/reviewPullRequestView";
import { SidebarPullRequestProvider } from "./features/pullRequests/views/sidebarPullRequestProvider";
import type { RepoInfo } from "./context/repoManager";
import type { GiteaPullRequest } from "./api/types";

const systemPollingClock: PollingClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = initOutputChannel();
  context.subscriptions.push(outputChannel);

  const auth = new AuthManager(context);
  const repoManager = new RepoManager(() => auth.getServerUrls());
  const api = new ResilientGiteaApiClient(auth);
  const metadataApi = new PullRequestMetadataApi(auth);
  const issueMetadataApi = new RepositoryMetadataApi(auth);
  const issueTemplateService = new IssueTemplateService(auth);
  const reviewApi = new PullRequestReviewApi(auth);
  const prSession = new PullRequestSessionService();
  const reviewSessions = new PullRequestReviewSessionService();
  const pollingSignals = new PollingLifecycleSignalService(prSession, reviewSessions);
  const pollingScheduler = new PollingScheduler(systemPollingClock);
  const reviewConversations = new PullRequestConversationService(api);
  const issueCreationSession = new IssueCreationSessionService();
  const branchCleanup = new BranchCleanupService();
  const conflictResolution = new ConflictResolutionService();
  const reviewedFiles = new ReviewedFileStateService(context.workspaceState, api);
  const workingFileBridge = new WorkingFileBridgeService(repoManager);
  const snapshotDocuments = new PullRequestSnapshotDocumentProvider(
    api,
    repoManager,
  );
  const nativeReviewProjection = new NativeReviewProjectionService(
    reviewConversations,
    repoManager,
    prSession,
    reviewSessions,
  );
  const reviewNavigationSignals = new ReviewNavigationSignalService(
    reviewConversations,
    reviewSessions,
    prSession,
    repoManager,
  );
  const prSessionCoordinator = new PullRequestSessionCoordinator(
    api,
    repoManager,
    prSession,
    reviewedFiles,
  );
  const conflictResolutionCoordinator = new ConflictResolutionCoordinator(
    repoManager,
    prSession,
    conflictResolution,
    reviewApi,
  );

  const prProvider = new SidebarPullRequestProvider(api, repoManager, auth);
  const createPullRequestView = new CreatePullRequestViewProvider(
    api,
    metadataApi,
    repoManager,
    prSession,
    prProvider,
  );
  const createIssueView = new CreateIssueViewProvider(
    api,
    issueMetadataApi,
    issueTemplateService,
    repoManager,
    issueCreationSession,
  );
  const reviewPullRequestView = new ReviewPullRequestViewProvider(
    api,
    reviewApi,
    repoManager,
    prSession,
    prProvider,
    context.workspaceState,
  );
  const postMergePullRequestView = new PostMergePullRequestViewProvider(
    repoManager,
    prSession,
    branchCleanup,
  );
  const trackedCreatePullRequestView = new PollingVisibilityWebviewProvider(
    createPullRequestView,
    "pull-request-create",
    pollingSignals,
  );
  const trackedReviewPullRequestView = new PollingVisibilityWebviewProvider(
    reviewPullRequestView,
    "pull-request-review",
    pollingSignals,
  );
  const trackedPostMergePullRequestView = new PollingVisibilityWebviewProvider(
    postMergePullRequestView,
    "pull-request-post-merge",
    pollingSignals,
  );
  const ciProvider = new CIRunsProvider(api, repoManager, auth);
  const issuesProvider = new IssuesProvider(api, repoManager, auth);
  const statusBar = new StatusBarManager(repoManager, auth);
  const activePullRequestPolling = new ActivePullRequestPollingService(
    pollingScheduler,
    pollingSignals,
    api,
    repoManager,
    prSession,
    prProvider,
  );
  const ciRunsPolling = new CIRunsPollingService(
    pollingScheduler,
    pollingSignals,
    ciProvider,
  );

  const ciRunsTree = vscode.window.createTreeView("gitea.ciRuns", {
    treeDataProvider: ciProvider,
  });
  const ciRunsCreateCompactTree = vscode.window.createTreeView(
    "gitea.ciRunsCreateCompact",
    { treeDataProvider: ciProvider },
  );
  const ciRunsIssueCreateCompactTree = vscode.window.createTreeView(
    "gitea.ciRunsIssueCreateCompact",
    { treeDataProvider: ciProvider },
  );
  const ciVisibility = new PollingVisibilityTreeViewTracker(
    "ci-runs",
    pollingSignals,
  );
  ciVisibility.track(ciRunsTree);
  ciVisibility.track(ciRunsCreateCompactTree);
  ciVisibility.track(ciRunsIssueCreateCompactTree);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      PULL_REQUEST_SNAPSHOT_SCHEME,
      snapshotDocuments,
    ),
    vscode.window.registerTreeDataProvider("gitea.pullRequests", prProvider),
    vscode.window.registerTreeDataProvider("gitea.pullRequestsCreateMode", prProvider),
    vscode.window.registerTreeDataProvider("gitea.pullRequestsIssueCreateCompact", prProvider),
    vscode.window.registerWebviewViewProvider(
      CreatePullRequestViewProvider.viewType,
      trackedCreatePullRequestView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      CreateIssueViewProvider.viewType,
      createIssueView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      ReviewPullRequestViewProvider.viewType,
      trackedReviewPullRequestView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      PostMergePullRequestViewProvider.viewType,
      trackedPostMergePullRequestView,
    ),
    ciRunsTree,
    ciRunsCreateCompactTree,
    ciRunsIssueCreateCompactTree,
    ciVisibility,
    vscode.window.registerTreeDataProvider("gitea.issues", issuesProvider),
    vscode.window.registerTreeDataProvider("gitea.issuesCreateCompact", issuesProvider),
    vscode.window.registerTreeDataProvider("gitea.issuesIssueCreateMode", issuesProvider),
    vscode.commands.registerCommand("gitea.createPRSidebar", async () => {
      if (issueCreationSession.current.kind === "creating") {
        vscode.window.showWarningMessage(
          "Close Issue creation before starting a Pull Request.",
        );
        return;
      }
      await createPullRequestView.start();
    }),
    vscode.commands.registerCommand("gitea.createIssue", async () => {
      if (prSession.current.kind === "creating") {
        vscode.window.showWarningMessage(
          "Close Pull Request creation before starting an Issue.",
        );
        return;
      }
      await createIssueView.start();
    }),
    vscode.commands.registerCommand("gitea.refreshCreateIssue", () =>
      createIssueView.refresh(),
    ),
    vscode.commands.registerCommand("gitea.cancelCreateIssue", async () => {
      if (issueCreationSession.current.kind === "creating") {
        await issueCreationSession.clear();
      }
    }),
    vscode.commands.registerCommand("gitea.refreshCreatePR", () =>
      createPullRequestView.refreshBranches(),
    ),
    vscode.commands.registerCommand("gitea.refreshPostMerge", () =>
      postMergePullRequestView.refreshBranchState(),
    ),
    vscode.commands.registerCommand(
      "gitea.getReviewCapabilities",
      async (repoInfo: RepoInfo) => reviewApi.getServerCapabilities(repoInfo),
    ),
    vscode.commands.registerCommand(
      "gitea.getReviewConversationSnapshot",
      (repoInfo: RepoInfo, pullRequest: GiteaPullRequest, force = false) =>
        reviewConversations.load(repoInfo, pullRequest, force),
    ),
    vscode.commands.registerCommand(
      "gitea.getPendingReviewSession",
      (repoInfo: RepoInfo, pullRequestNumber: number) =>
        reviewSessions.get(repoInfo, pullRequestNumber),
    ),
    vscode.commands.registerCommand(
      "gitea.replacePendingReviewSession",
      (
        repoInfo: RepoInfo,
        pullRequestNumber: number,
        session: PendingReviewSession,
      ) => reviewSessions.replace(repoInfo, pullRequestNumber, session),
    ),
    vscode.commands.registerCommand(
      "gitea.queuePendingInlineReviewComment",
      (
        repoInfo: RepoInfo,
        pullRequestNumber: number,
        comment: PendingInlineComment,
      ) => reviewSessions.queueInlineComment(repoInfo, pullRequestNumber, comment),
    ),
    vscode.commands.registerCommand(
      "gitea.queuePendingReviewReply",
      (
        repoInfo: RepoInfo,
        pullRequestNumber: number,
        reply: PendingReviewReply,
      ) => reviewSessions.queueReply(repoInfo, pullRequestNumber, reply),
    ),
    vscode.commands.registerCommand(
      "gitea.queuePendingConversationAction",
      (
        repoInfo: RepoInfo,
        pullRequestNumber: number,
        action: PendingConversationAction,
      ) =>
        reviewSessions.queueConversationAction(
          repoInfo,
          pullRequestNumber,
          action,
        ),
    ),
    vscode.commands.registerCommand(
      "gitea.removePendingReviewOperation",
      (repoInfo: RepoInfo, pullRequestNumber: number, pendingId: string) =>
        reviewSessions.remove(repoInfo, pullRequestNumber, pendingId),
    ),
    vscode.commands.registerCommand(
      "gitea.clearPendingReviewSession",
      (repoInfo: RepoInfo, pullRequestNumber: number) =>
        reviewSessions.clear(repoInfo, pullRequestNumber),
    ),
    vscode.commands.registerCommand(
      "gitea.reconcilePendingReviewSession",
      (
        repoInfo: RepoInfo,
        pullRequestNumber: number,
        result: Parameters<PullRequestReviewSessionService["reconcile"]>[2],
      ) => reviewSessions.reconcile(repoInfo, pullRequestNumber, result),
    ),
    vscode.commands.registerCommand(
      "gitea.replyInlineReviewComment",
      async (
        repoInfo: RepoInfo,
        pullRequestNumber: number,
        commentId: number,
        body: string,
      ) => {
        if (!body?.trim()) return;
        await reviewApi.replyToReviewComment(
          repoInfo,
          pullRequestNumber,
          commentId,
          body.trim(),
        );
      },
    ),
    vscode.commands.registerCommand(
      "gitea.resolveInlineReviewConversation",
      async (repoInfo: RepoInfo, commentId: number) => {
        await reviewApi.resolveReviewComment(repoInfo, commentId);
      },
    ),
    vscode.commands.registerCommand(
      "gitea.reopenInlineReviewConversation",
      async (repoInfo: RepoInfo, commentId: number) => {
        await reviewApi.reopenReviewComment(repoInfo, commentId);
      },
    ),
    vscode.commands.registerCommand("gitea.openActivePR", async () => {
      const state = prSession.current;
      if (state.kind !== "active") {
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(state.pullRequest.html_url));
    }),
    vscode.commands.registerCommand("gitea.viewActivePRDetail", async () => {
      const state = prSession.current;
      if (state.kind !== "active") {
        return;
      }
      const repoInfo = repoManager
        .getRepos()
        .find((repo) => repo.key === state.repository.key);
      if (!repoInfo) {
        return;
      }
      await PRDetailPanel.show(
        context.extensionUri,
        createPullRequestConversationApiView(
          api,
          reviewConversations,
          repoInfo,
          state.pullRequest,
        ),
        repoInfo,
        state.pullRequest,
      );
    }),
    auth.onDidChangeSession(() => {
      void repoManager.detect();
    }),
    trackedCreatePullRequestView,
    trackedReviewPullRequestView,
    trackedPostMergePullRequestView,
    createPullRequestView,
    createIssueView,
    reviewPullRequestView,
    postMergePullRequestView,
    pollingSignals,
    activePullRequestPolling,
    ciRunsPolling,
    pollingScheduler,
    prSessionCoordinator,
    conflictResolutionCoordinator,
    nativeReviewProjection,
    reviewNavigationSignals,
    prSession,
    reviewSessions,
    reviewConversations,
    issueCreationSession,
    ciProvider,
    statusBar,
  );

  registerAuthCommands(
    context,
    auth,
    api,
    repoManager,
    prProvider,
    ciProvider,
    statusBar,
  );
  registerPullRequestSessionCommands(context, prSession);
  registerConflictResolutionCommands(
    context,
    repoManager,
    prSession,
    conflictResolution,
  );
  registerWorkingFileCommands(
    context,
    api,
    conflictResolution,
    workingFileBridge,
  );
  registerRefreshActivePullRequestCommand(
    context,
    api,
    repoManager,
    prSession,
    prProvider,
  );
  registerPRCommands(
    context,
    api,
    repoManager,
    auth,
    prProvider,
    reviewedFiles,
    workingFileBridge,
    reviewConversations,
  );
  registerCICommands(context, api, ciProvider);
  registerIssueCommands(context, api, repoManager, auth, issuesProvider);

  await auth.initialize();
  await repoManager.initialize();
  await prSession.initialize();
  await issueCreationSession.initialize();
  pollingSignals.initialize();
  activePullRequestPolling.initialize();
  ciRunsPolling.initialize();
  await prSessionCoordinator.initialize();
  await conflictResolutionCoordinator.initialize();
  await nativeReviewProjection.initialize();
  await reviewNavigationSignals.initialize();
  statusBar.refresh();

  const session = await auth.getSession();
  await vscode.commands.executeCommand(
    "setContext",
    "gitea.authenticated",
    !!session,
  );
}

export function deactivate(): void {}
