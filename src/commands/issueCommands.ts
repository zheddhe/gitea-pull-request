import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoManager, RepoInfo } from "../context/repoManager";
import { AuthManager } from "../auth/authManager";
import {
  IssuesProvider,
  IssueItem,
  type IssueFilter,
} from "../views/issuesProvider";
import { IssueDetailPanel } from "../views/issueDetailPanel";
import type { GiteaIssue } from "../api/types";

interface IssueFilterQuickPickItem extends vscode.QuickPickItem {
  filter: IssueFilter;
}

export function registerIssueCommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  _repoManager: RepoManager,
  _auth: AuthManager,
  issuesProvider: IssuesProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.refreshIssues", () =>
      issuesProvider.refresh(),
    ),

    vscode.commands.registerCommand("gitea.configureIssueFilter", async () => {
      const current = issuesProvider.getFilter();
      const choice = await vscode.window.showQuickPick<IssueFilterQuickPickItem>(
        [
          {
            filter: "open",
            label: "$(issues) Open issues",
            description: current === "open" ? "Current" : undefined,
          },
          {
            filter: "closed",
            label: "$(issue-closed) Closed issues",
            description: current === "closed" ? "Current" : undefined,
          },
        ],
        {
          title: "Filter Gitea Issues",
          placeHolder: "Choose which issue state to show",
        },
      );
      if (choice) {
        issuesProvider.setFilter(choice.filter);
      }
    }),

    vscode.commands.registerCommand(
      "gitea.loadMoreIssues",
      (repoKey: string) => {
        issuesProvider.loadMore(repoKey);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.openIssue",
      async (arg: IssueItem | GiteaIssue) => {
        const issue = arg instanceof IssueItem ? arg.issue : arg;
        await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
      },
    ),

    vscode.commands.registerCommand(
      "gitea.viewIssueDetail",
      async (item: IssueItem) => {
        await IssueDetailPanel.show(
          context.extensionUri,
          api,
          item.repoInfo,
          item.issue,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.closeIssue",
      async (arg: IssueItem) => {
        if (!(arg instanceof IssueItem)) {
          return;
        }
        await changeIssueState(
          api,
          arg.issue,
          arg.repoInfo,
          "closed",
          issuesProvider,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.reopenIssue",
      async (arg: IssueItem) => {
        if (!(arg instanceof IssueItem)) {
          return;
        }
        await changeIssueState(
          api,
          arg.issue,
          arg.repoInfo,
          "open",
          issuesProvider,
        );
      },
    ),
  );
}

async function changeIssueState(
  api: GiteaApiClient,
  issue: GiteaIssue,
  repoInfo: RepoInfo,
  state: "open" | "closed",
  issuesProvider: IssuesProvider,
): Promise<void> {
  try {
    if (state === "closed") {
      await api.closeIssue(repoInfo, issue.number);
      vscode.window.showInformationMessage(`Issue #${issue.number} closed.`);
    } else {
      await api.reopenIssue(repoInfo, issue.number);
      vscode.window.showInformationMessage(`Issue #${issue.number} re-opened.`);
    }
    issuesProvider.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
  }
}
