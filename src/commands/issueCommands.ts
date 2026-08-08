import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoManager, RepoInfo } from "../context/repoManager";
import { AuthManager } from "../auth/authManager";
import { IssuesProvider, IssueItem } from "../views/issuesProvider";
import { IssueDetailPanel } from "../views/issueDetailPanel";
import type { GiteaIssue } from "../api/types";

export function registerIssueCommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  repoManager: RepoManager,
  auth: AuthManager,
  issuesProvider: IssuesProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.refreshIssues", () =>
      issuesProvider.refresh(),
    ),

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
      async (repoKey: string, issueNumber: number) => {
        const repoInfo = repoManager.getRepos().find((r) => r.key === repoKey);
        if (!repoInfo) {
          vscode.window.showErrorMessage("Repository not found.");
          return;
        }
        try {
          const issue = await api.getIssue(repoInfo, issueNumber);
          await IssueDetailPanel.show(context.extensionUri, api, repoInfo, issue);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to load issue: ${(err as Error).message}`,
          );
        }
      },
    ),

    vscode.commands.registerCommand("gitea.createIssue", async () => {
      await createIssue(api, repoManager, auth, issuesProvider);
    }),

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

    vscode.commands.registerCommand(
      "gitea.addIssueComment",
      async (arg?: IssueItem) => {
        if (arg instanceof IssueItem) {
          await addComment(api, arg.repoInfo, arg.issue.number, issuesProvider);
        } else {
          const repoInfo = await pickRepo(repoManager, auth);
          if (!repoInfo) {
            return;
          }
          const numStr = await vscode.window.showInputBox({
            prompt: "Issue number",
            ignoreFocusOut: true,
            validateInput: (v) => (/^\d+$/.test(v) ? null : "Enter a number"),
          });
          if (!numStr) {
            return;
          }
          await addComment(api, repoInfo, parseInt(numStr, 10), issuesProvider);
        }
      },
    ),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pickRepo(
  repoManager: RepoManager,
  auth: AuthManager,
): Promise<RepoInfo | undefined> {
  const repos = repoManager.getRepos();
  if (repos.length === 0) {
    vscode.window.showErrorMessage("No Gitea repositories detected.");
    return undefined;
  }
  if (repos.length === 1) {
    return repos[0];
  }
  const choice = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: r.label,
      description: r.serverUrl,
      repoInfo: r,
    })),
    { placeHolder: "Select a repository" },
  );
  return choice?.repoInfo;
}

async function createIssue(
  api: GiteaApiClient,
  repoManager: RepoManager,
  auth: AuthManager,
  issuesProvider: IssuesProvider,
): Promise<void> {
  const repoInfo = await pickRepo(repoManager, auth);
  if (!repoInfo) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Issue title",
    ignoreFocusOut: true,
    validateInput: (v) => (v?.trim() ? null : "Title is required"),
  });
  if (!title) {
    return;
  }

  const body =
    (await vscode.window.showInputBox({
      prompt: "Description (optional)",
      ignoreFocusOut: true,
    })) ?? "";

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Creating issue...",
    },
    async () => {
      try {
        const issue = await api.createIssue(repoInfo, { title, body });
        const action = await vscode.window.showInformationMessage(
          `Issue #${issue.number} created.`,
          "Open in Browser",
        );
        if (action === "Open in Browser") {
          await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
        }
        issuesProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to create issue: ${(err as Error).message}`,
        );
      }
    },
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

async function addComment(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  issueNumber: number,
  issuesProvider: IssuesProvider,
): Promise<void> {
  const body = await vscode.window.showInputBox({
    prompt: `Comment on Issue #${issueNumber}`,
    ignoreFocusOut: true,
    validateInput: (v) => (v?.trim() ? null : "Comment cannot be empty"),
  });
  if (!body) {
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Posting comment...",
    },
    async () => {
      try {
        await api.addIssueComment(repoInfo, issueNumber, body);
        vscode.window.showInformationMessage("Comment posted.");
        issuesProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
      }
    },
  );
}
