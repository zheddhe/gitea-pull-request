import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import type { RepoManager } from "../context/repoManager";

export class StatusBarManager implements vscode.Disposable {
  private readonly authItem: vscode.StatusBarItem;
  private readonly auth: AuthManager;
  private disposables: vscode.Disposable[] = [];

  constructor(_repoManager: RepoManager, auth: AuthManager) {
    this.auth = auth;
    this.authItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99,
    );
    this.authItem.command = "gitea.manageAccounts";

    this.disposables.push(
      this.authItem,
      auth.onDidChangeSession(() => this.refresh()),
    );

    this.refresh();
  }

  refresh(): void {
    const servers = this.auth.getServerUrls();

    if (servers.length === 0) {
      this.authItem.text = "$(account) Sign in to Gitea";
      this.authItem.tooltip = "Gitea: Sign in or manage accounts";
      this.authItem.command = "gitea.manageAccounts";
      this.authItem.show();
      return;
    }

    const accounts = this.auth.getAccountMap();
    if (servers.length === 1) {
      const serverUrl = servers[0];
      const username = accounts[serverUrl]?.username ?? "Signed in";
      const host = displayHost(serverUrl);
      this.authItem.text = `$(account) ${username} @ ${host}`;
      this.authItem.tooltip = `Gitea: ${username} @ ${serverUrl} (PAT) — click to manage`;
    } else {
      this.authItem.text = `$(account) Gitea: ${servers.length} accounts`;
      this.authItem.tooltip = `Gitea: ${servers.length} authenticated instances — click to manage`;
    }
    this.authItem.command = "gitea.manageAccounts";
    this.authItem.show();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

function displayHost(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return serverUrl;
  }
}
