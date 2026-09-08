import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoManager } from "../context/repoManager";
import { PullRequestProvider } from "../views/pullRequestProvider";
import { CIRunsProvider } from "../views/ciRunsProvider";
import { StatusBarManager } from "../ui/statusBar";

interface AccountQuickPickItem extends vscode.QuickPickItem {
  serverUrl?: string;
  action: "account" | "signIn" | "rescan";
}

export function registerAuthCommands(
  context: vscode.ExtensionContext,
  auth: AuthManager,
  _api: GiteaApiClient,
  repoManager: RepoManager,
  prProvider: PullRequestProvider,
  ciProvider: CIRunsProvider,
  statusBar: StatusBarManager,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.signIn", async () => {
      await cmdSignIn(auth, repoManager, prProvider, ciProvider, statusBar);
    }),
    vscode.commands.registerCommand("gitea.signOut", async () => {
      await cmdSignOut(auth, repoManager, prProvider, ciProvider, statusBar);
    }),
    vscode.commands.registerCommand("gitea.addServer", async () => {
      await cmdSignIn(auth, repoManager, prProvider, ciProvider, statusBar);
    }),
    vscode.commands.registerCommand("gitea.manageAccounts", async () => {
      await cmdManageAccounts(
        auth,
        repoManager,
        prProvider,
        ciProvider,
        statusBar,
      );
    }),
    vscode.commands.registerCommand("gitea.rescanRepositories", async () => {
      await cmdRescanRepositories(repoManager, prProvider, ciProvider, statusBar);
    }),
    // Compatibility for the pre-9.3 command id. It is no longer a repository
    // selector; repository mapping is automatic and deterministic.
    vscode.commands.registerCommand("gitea.switchRepo", async () => {
      await cmdRescanRepositories(repoManager, prProvider, ciProvider, statusBar);
    }),
  );
}

async function cmdSignIn(
  auth: AuthManager,
  repoManager: RepoManager,
  prProvider: PullRequestProvider,
  ciProvider: CIRunsProvider,
  statusBar: StatusBarManager,
  initialServerUrl?: string,
): Promise<void> {
  const serverUrl = await vscode.window.showInputBox({
    prompt: "Enter your Gitea server URL (e.g. https://gitea.example.com)",
    placeHolder: "https://gitea.example.com",
    value: initialServerUrl,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value) return "URL is required";
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return "Gitea server URL must use HTTP or HTTPS";
        }
        return null;
      } catch {
        return "Invalid URL";
      }
    },
  });
  if (!serverUrl) return;

  const token = await vscode.window.showInputBox({
    prompt: `Enter your Personal Access Token for ${serverUrl}`,
    placeHolder: "Gitea Personal Access Token",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value ? null : "Token is required"),
  });
  if (!token) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Signing in to Gitea...",
    },
    async () => {
      try {
        const account = await auth.signIn(serverUrl, token);
        await vscode.commands.executeCommand(
          "setContext",
          "gitea.authenticated",
          true,
        );
        await repoManager.detect();
        vscode.window.showInformationMessage(
          `Signed in as ${account.username} @ ${account.serverUrl}`,
        );
        refreshAuthDependentViews(prProvider, ciProvider, statusBar);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Sign in failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

async function cmdSignOut(
  auth: AuthManager,
  repoManager: RepoManager,
  prProvider: PullRequestProvider,
  ciProvider: CIRunsProvider,
  statusBar: StatusBarManager,
  requestedServerUrl?: string,
): Promise<void> {
  const servers = auth.getServerUrls();
  if (servers.length === 0) {
    vscode.window.showInformationMessage("Not signed in to any Gitea server.");
    return;
  }

  const accounts = auth.getAccountMap();
  const serverUrl =
    requestedServerUrl ??
    (servers.length === 1
      ? servers[0]
      : await vscode.window.showQuickPick(servers, {
          placeHolder: "Select Gitea instance to sign out of",
        }));
  if (!serverUrl) return;

  const username = accounts[serverUrl]?.username;
  await auth.signOut(serverUrl);
  await repoManager.detect();
  const remaining = auth.getServerUrls();
  await vscode.commands.executeCommand(
    "setContext",
    "gitea.authenticated",
    remaining.length > 0,
  );
  vscode.window.showInformationMessage(
    `Signed out${username ? ` ${username} from` : " from"} ${serverUrl}.`,
  );
  refreshAuthDependentViews(prProvider, ciProvider, statusBar);
}

async function cmdManageAccounts(
  auth: AuthManager,
  repoManager: RepoManager,
  prProvider: PullRequestProvider,
  ciProvider: CIRunsProvider,
  statusBar: StatusBarManager,
): Promise<void> {
  const servers = auth.getServerUrls();
  if (servers.length === 0) {
    await cmdSignIn(auth, repoManager, prProvider, ciProvider, statusBar);
    return;
  }

  const accounts = auth.getAccountMap();
  const items: AccountQuickPickItem[] = servers.map((serverUrl) => ({
    label: `$(account) ${accounts[serverUrl]?.username ?? "Gitea account"}`,
    description: serverUrl,
    detail: "Authentication: PAT",
    serverUrl,
    action: "account",
  }));
  items.push(
    {
      label: "$(add) Sign in to another Gitea instance",
      action: "signIn",
    },
    {
      label: "$(refresh) Re-scan Gitea repositories",
      description: "Recovery / diagnostics",
      action: "rescan",
    },
  );

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: "Manage Gitea accounts",
  });
  if (!choice) return;

  if (choice.action === "signIn") {
    await cmdSignIn(auth, repoManager, prProvider, ciProvider, statusBar);
    return;
  }
  if (choice.action === "rescan") {
    await cmdRescanRepositories(repoManager, prProvider, ciProvider, statusBar);
    return;
  }
  if (!choice.serverUrl) return;

  const accountAction = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Replace Personal Access Token",
        action: "replace" as const,
      },
      {
        label: "$(sign-out) Sign out of this Gitea instance",
        action: "signOut" as const,
      },
    ],
    { placeHolder: choice.serverUrl },
  );
  if (!accountAction) return;

  if (accountAction.action === "replace") {
    await cmdSignIn(
      auth,
      repoManager,
      prProvider,
      ciProvider,
      statusBar,
      choice.serverUrl,
    );
  } else {
    await cmdSignOut(
      auth,
      repoManager,
      prProvider,
      ciProvider,
      statusBar,
      choice.serverUrl,
    );
  }
}

async function cmdRescanRepositories(
  repoManager: RepoManager,
  prProvider: PullRequestProvider,
  ciProvider: CIRunsProvider,
  statusBar: StatusBarManager,
): Promise<void> {
  await repoManager.detect();
  prProvider.refresh();
  ciProvider.refresh();
  statusBar.refresh();
  vscode.window.showInformationMessage("Gitea: repositories re-scanned.");
}

function refreshAuthDependentViews(
  prProvider: PullRequestProvider,
  ciProvider: CIRunsProvider,
  statusBar: StatusBarManager,
): void {
  prProvider.refresh();
  ciProvider.refresh();
  statusBar.refresh();
}
