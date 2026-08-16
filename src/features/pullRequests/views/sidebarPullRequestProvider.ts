import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { AuthManager } from "../../../auth/authManager";
import { RepoManager } from "../../../context/repoManager";
import { PullRequestProvider } from "../../../views/pullRequestProvider";

/**
 * Sidebar-specific presentation policy layered on the legacy PR tree provider
 * while the sidebar-first migration is still in progress.
 */
export class SidebarPullRequestProvider extends PullRequestProvider {
  constructor(api: GiteaApiClient, repoManager: RepoManager, auth: AuthManager) {
    super(api, repoManager, auth);
  }

  override async getChildren(
    element?: vscode.TreeItem,
  ): Promise<vscode.TreeItem[]> {
    const items = await super.getChildren(element);

    for (const item of items) {
      if (item.contextValue === "category-waiting") {
        // This category is actionable and should be visible immediately.
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        // The category aggregates PRs with potentially different review states;
        // keep the category icon neutral and color the individual PR icons only.
        item.iconPath = new vscode.ThemeIcon("folder");
      }
    }

    return items;
  }
}
