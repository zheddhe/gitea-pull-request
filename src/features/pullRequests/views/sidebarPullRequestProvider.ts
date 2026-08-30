import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { AuthManager } from "../../../auth/authManager";
import { RepoManager } from "../../../context/repoManager";
import {
  PullRequestItem,
  PullRequestProvider,
} from "../../../views/pullRequestProvider";

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
      if (item.contextValue === "repoGroup") {
        // Entering the Gitea workspace should expose the useful PR categories
        // immediately instead of requiring a first expansion per repository.
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }

      if (
        item.contextValue === "category-all" ||
        item.contextValue === "category-waiting"
      ) {
        // The primary open-PR and actionable assigned/review queues should be
        // visible on first entry. Users can still collapse them afterwards and
        // VS Code remains free to persist their subsequent tree interaction.
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
    }

    if (element instanceof PullRequestItem && element.pr.body?.trim()) {
      const detailItem = items.find(
        (item) => item.command?.command === "gitea.viewPRDetail",
      );
      if (detailItem) {
        const preview = new vscode.MarkdownString(element.pr.body);
        preview.isTrusted = false;
        preview.supportHtml = false;
        detailItem.tooltip = preview;
      }
    }

    return items;
  }
}
