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
import { registerConflictResolutionCommands } from "./features/pullRequests/commands/conflictResolutionCommands";
import { registerPullRequestSessionCommands } from "./features/pullRequests/commands/sessionCommands";
import { registerRefreshActivePullRequestCommand } from "./features/pullRequests/commands/refreshActivePullRequestCommand";
import { registerWorkingFileCommands } from "./features/pullRequests/commands/workingFileCommands";
import { BranchCleanupService } from "./features/pullRequests/services/branchCleanupService";
import { ConflictResolutionCoordinator } from "./features/pullRequests/services/conflictResolutionCoordinator";
import { ConflictResolutionService } from "./features/pullRequests/services/conflictResolutionService";
import { PullRequestSessionCoordinator } from "./features/pullRequests/services/pullRequestSessionCoordinator";
import { PullRequestSessionService } from "./features/pullRequests/services/pullRequestSessionService";
import { PullRequestReviewApi } from "./features/pullRequests/services/pullRequestReviewApi";
import { ResilientGiteaApiClient } from "./features/pullRequests/services/resilientGiteaApiClient";
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
  const issueCreationSession = new IssueCreationSessionService();
  const branchCleanup = new BranchCleanupService();
  const conflictResolution = new ConflictResolutionService();
  const reviewedFiles = new ReviewedFileStateService(context.workspaceState, api);
  const workingFileBridge = new WorkingFileBridgeService(repoManager);
  const snapshotDocuments = new PullRequestSnapshotDocumentProvider(
    api,
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
  const ciProvider = new CIRunsProvider(api, repoManager, auth);
  const issuesProvider = new IssuesProvider(api, repoManager, auth);
  const statusBar = new StatusBarManager(repoManager, auth);

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
      createPullRequestView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      CreateIssueViewProvider.viewType,
      createIssueView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      ReviewPullRequestViewProvider.viewType,
      reviewPullRequestView,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      PostMergePullRequestViewProvider.viewType,
      postMergePullRequestView,
    ),
    vscode.window.registerTreeDataProvider("gitea.ciRuns", ciProvider),
    vscode.window.registerTreeDataProvider("gitea.ciRunsCreateCompact", ciProvider),
    vscode.window.registerTreeDataProvider("gitea.ciRunsIssueCreateCompact", ciProvider),
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
        api,
        repoInfo,
        state.pullRequest,
      );
    }),
    auth.onDidChangeSession(() => {
      void repoManager.detect();
    }),
    createPullRequestView,
    createIssueView,
    reviewPullRequestView,
    postMergePullRequestView,
    prSessionCoordinator,
    conflictResolutionCoordinator,
    prSession,
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
  );
  registerCICommands(context, api, ciProvider);
  registerIssueCommands(context, api, repoManager, auth, issuesProvider);

  await auth.initialize();
  await repoManager.initialize();
  await prSession.initialize();
  await issueCreationSession.initialize();
  await prSessionCoordinator.initialize();
  await conflictResolutionCoordinator.initialize();
  statusBar.refresh();

  const session = await auth.getSession();
  await vscode.commands.executeCommand(
    "setContext",
    "gitea.authenticated",
    !!session,
  );
}

export function deactivate(): void {}
