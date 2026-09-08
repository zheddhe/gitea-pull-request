import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import {
  capabilityRegistry,
  type GiteaCapability,
} from "../auth/capabilityRegistry";
import { GiteaApiClient } from "../api/giteaApiClient";
import { isGiteaApiError } from "../api/giteaApiError";
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
  api: GiteaApiClient,
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
        api,
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
    prompt:
      "PAT scopes — full workflow: read:user + write:repository + write:issue. Read-only: read:user + read:repository + read:issue. Scopes never elevate the Gitea account's own permissions.",
    placeHolder: `Personal Access Token for ${serverUrl}`,
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
        capabilityRegistry.reset(account.serverUrl);
        capabilityRegistry.markVerified(account.serverUrl, "identity.read");
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
  capabilityRegistry.reset(serverUrl);
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
  api: GiteaApiClient,
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
        label: "$(pulse) Authentication diagnostics",
        detail: "Probe safe read capabilities and show observed permissions",
        action: "diagnostics" as const,
      },
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

  if (accountAction.action === "diagnostics") {
    await showAuthenticationDiagnostics(
      api,
      repoManager,
      choice.serverUrl,
      accounts[choice.serverUrl]?.username,
    );
  } else if (accountAction.action === "replace") {
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

async function showAuthenticationDiagnostics(
  api: GiteaApiClient,
  repoManager: RepoManager,
  serverUrl: string,
  username?: string,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking Gitea capabilities for ${serverUrl}`,
    },
    async () => {
      await observeReadCapability(
        serverUrl,
        "identity.read",
        () => api.getCurrentUser(serverUrl),
      );

      const repo = repoManager
        .getRepos()
        .find((candidate) => candidate.serverUrl === serverUrl);
      if (repo) {
        await observeReadCapability(
          serverUrl,
          "repository.read",
          () => api.listPullRequests(repo, "open", 1, 1),
        );
        await observeReadCapability(
          serverUrl,
          "issues.read",
          () => api.listIssues(repo, "open", 1, 1),
        );
        await observeReadCapability(
          serverUrl,
          "actions.read",
          () => api.listWorkflowRuns(repo, undefined, 1, 1),
          true,
        );
      }
    },
  );

  const items: vscode.QuickPickItem[] = [
    {
      label: `$(account) ${username ?? "Gitea account"}`,
      description: serverUrl,
      detail: "Authentication method: PAT",
    },
    ...capabilityRegistry.snapshot(serverUrl).map(({ capability, state }) => ({
      label: `${stateIcon(state)} ${capability}`,
      description: state,
      detail: capabilityDetail(capability, state),
    })),
  ];

  await vscode.window.showQuickPick(items, {
    placeHolder: "Gitea authentication diagnostics — observed runtime state",
    canPickMany: false,
  });
}

async function observeReadCapability(
  serverUrl: string,
  capability: GiteaCapability,
  operation: () => Promise<unknown>,
  unsupportedOnMissingEndpoint = false,
): Promise<void> {
  try {
    await operation();
    capabilityRegistry.markVerified(serverUrl, capability);
  } catch (error) {
    if (!isGiteaApiError(error)) return;
    if (error.kind === "authorization") {
      capabilityRegistry.markDenied(serverUrl, capability);
      return;
    }
    if (
      unsupportedOnMissingEndpoint &&
      error.kind === "api" &&
      (error.status === 404 || error.status === 405)
    ) {
      capabilityRegistry.markUnsupported(serverUrl, capability);
    }
  }
}

function stateIcon(state: string): string {
  switch (state) {
    case "verified":
      return "$(pass-filled)";
    case "denied":
      return "$(error)";
    case "unsupported":
      return "$(circle-slash)";
    default:
      return "$(question)";
  }
}

function capabilityDetail(capability: GiteaCapability, state: string): string {
  if (state === "unknown") {
    return capability.endsWith(".write")
      ? "Not observed yet; no write action is performed by diagnostics"
      : "No conclusive runtime observation yet";
  }
  if (state === "verified") return "Verified by a successful Gitea API call";
  if (state === "denied") return "Denied by Gitea (403) for the active account";
  return "Endpoint is not available on this Gitea instance";
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
