import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { PullRequestMetadataApi } from "./api/pullRequestMetadataApi";
import { RepoManager } from "./context/repoManager";
import { CIRunsProvider } from "./views/ciRunsProvider";
import { IssuesProvider } from "./views/issuesProvider";
import { StatusBarManager } from "./ui/statusBar";
import { registerPRCommands } from "./commands/prCommands";
import { registerCICommands } from "./commands/ciCommands";
import { registerAuthCommands } from "./commands/authCommands";
import { registerIssueCommands } from "./commands/issueCommands";
import { initOutputChannel } from "./debug/outputChannel";
import { registerPullRequestSessionCommands } from "./features/pullRequests/commands/sessionCommands";
import { registerRefreshActivePullRequestCommand } from "./features/pullRequests/commands/refreshActivePullRequestCommand";
import { BranchCleanupService } from "./features/pullRequests/services/branchCleanupService";
import { PullRequestSessionCoordinator } from "./features/pullRequests/services/pullRequestSessionCoordinator";
import { PullRequestSessionService } from "./features/pullRequests/services/pullRequestSessionService";
import { PullRequestReviewApi } from "./features/pullRequests/services/pullRequestReviewApi";
import { ResilientGiteaApiClient } from "./features/pullRequests/services/resilientGiteaApiClient";
import { CreatePullRequestViewProvider } from "./features/pullRequests/views/createPullRequestView";
import { PostMergePullRequestViewProvider } from "./features/pullRequests/views/postMergePullRequestView";
import { ReviewPullRequestViewProvider } from "./features/pullRequests/views/reviewPullRequestView";
import { SidebarPullRequestProvider } from "./features/pullRequests/views/sidebarPullRequestProvider";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = initOutputChannel();
  context.subscriptions.push(outputChannel);

  const auth = new AuthManager(context);
  const repoManager = new RepoManager(() => auth.getServerUrls());
  const api = new ResilientGiteaApiClient(auth);
  const metadataApi = new PullRequestMetadataApi(auth);
  const reviewApi = new PullRequestReviewApi(auth);
  const prSession = new PullRequestSessionService();
  const branchCleanup = new BranchCleanupService();
  const prSessionCoordinator = new PullRequestSessionCoordinator(
    api,
    repoManager,
    prSession,
  );

  const prProvider = new SidebarPullRequestProvider(api, repoManager, auth);
  const createPullRequestView = new CreatePullRequestViewProvider(
    api,
    metadataApi,
    repoManager,
    prSession,
    prProvider,
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
    vscode.window.registerTreeDataProvider("gitea.pullRequests", prProvider),
    vscode.window.registerWebviewViewProvider(
      CreatePullRequestViewProvider.viewType,
      createPullRequestView,
    ),
    vscode.window.registerWebviewViewProvider(
      ReviewPullRequestViewProvider.viewType,
      reviewPullRequestView,
    ),
    vscode.window.registerWebviewViewProvider(
      PostMergePullRequestViewProvider.viewType,
      postMergePullRequestView,
    ),
    vscode.window.registerTreeDataProvider("gitea.ciRuns", ciProvider),
    vscode.window.registerTreeDataProvider("gitea.issues", issuesProvider),
    vscode.commands.registerCommand("gitea.createPRSidebar", () =>
      createPullRequestView.start(),
    ),
    auth.onDidChangeSession(() => {
      void repoManager.detect();
    }),
    createPullRequestView,
    reviewPullRequestView,
    postMergePullRequestView,
    prSessionCoordinator,
    prSession,
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
  registerRefreshActivePullRequestCommand(
    context,
    api,
    repoManager,
    prSession,
    prProvider,
  );
  registerPRCommands(context, api, repoManager, auth, prProvider);
  registerCICommands(context, api, ciProvider);
  registerIssueCommands(context, api, repoManager, auth, issuesProvider);

  await auth.initialize();
  await repoManager.initialize();
  await prSession.initialize();
  await prSessionCoordinator.initialize();
  statusBar.refresh();

  const session = await auth.getSession();
  await vscode.commands.executeCommand(
    "setContext",
    "gitea.authenticated",
    !!session,
  );
}

export function deactivate(): void {}
