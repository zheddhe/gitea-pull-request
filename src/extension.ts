import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { GiteaApiClient } from "./api/giteaApiClient";
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

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const outputChannel = initOutputChannel();
  context.subscriptions.push(outputChannel);

  const auth = new AuthManager(context);
  const repoManager = new RepoManager();
  const api = new GiteaApiClient(auth);

  const prProvider = new PullRequestProvider(api, repoManager, auth);
  const ciProvider = new CIRunsProvider(api, repoManager, auth);
  const issuesProvider = new IssuesProvider(api, repoManager, auth);
  const statusBar = new StatusBarManager(repoManager, auth);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("gitea.pullRequests", prProvider),
    vscode.window.registerTreeDataProvider("gitea.ciRuns", ciProvider),
    vscode.window.registerTreeDataProvider("gitea.issues", issuesProvider),
    ciProvider, // Register for disposal
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
  registerPRCommands(context, api, repoManager, auth, prProvider);
  registerCICommands(context, api, ciProvider);
  registerIssueCommands(context, api, repoManager, auth, issuesProvider);

  await auth.initialize();
  await repoManager.initialize();
  statusBar.refresh();

  // Set the when-clause context key
  const session = await auth.getSession();
  await vscode.commands.executeCommand(
    "setContext",
    "gitea.authenticated",
    !!session,
  );
}

export function deactivate(): void {}
