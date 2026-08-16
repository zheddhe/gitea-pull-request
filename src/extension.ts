import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { GiteaApiClient } from "./api/giteaApiClient";
import { PullRequestMetadataApi } from "./api/pullRequestMetadataApi";
import { RepoManager } from "./context/repoManager";
import { PullRequestProvider } from "./views/pullRequestProvider";
import { CIRunsProvider } from "./views/ciRunsProvider";
import { IssuesProvider } from "./views/issuesProvider";
import { StatusBarManager } from "./ui/statusBar";
import { registerPRCommands } from "./commands/prCommands";
import { registerCICommands } from "./commands/ciCommands";
import { registerAuthCommands } from "./commands/authCommands";
import { registerIssueCommands } from "./commands/issueCommands";
import { initOutputChannel } from "./debug/outputChannel";
import { registerPullRequestSessionCommands } from "./features/pullRequests/commands/sessionCommands";
import { PullRequestSessionCoordinator } from "./features/pullRequests/services/pullRequestSessionCoordinator";
import { PullRequestSessionService } from "./features/pullRequests/services/pullRequestSessionService";
import { CreatePullRequestViewProvider } from "./features/pullRequests/views/createPullRequestView";
import { ReviewPullRequestViewProvider } from "./features/pullRequests/views/reviewPullRequestView";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = initOutputChannel();
  context.subscriptions.push(outputChannel);

  const auth = new AuthManager(context);
  const repoManager = new RepoManager(() => auth.getServerUrls());
  const api = new GiteaApiClient(auth);
  const metadataApi = new PullRequestMetadataApi(auth);
  const prSession = new PullRequestSessionService();
  const prSessionCoordinator = new PullRequestSessionCoordinator(
    api,
    repoManager,
    prSession,
  );

  const prProvider = new PullRequestProvider(api, repoManager, auth);
  const createPullRequestView = new CreatePullRequestViewProvider(
    api,
    metadataApi,
    repoManager,
    prSession,
    prProvider,
  );
  const reviewPullRequestView = new ReviewPullRequestViewProvider(
    api,
    repoManager,
    prSession,
    prProvider,
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
