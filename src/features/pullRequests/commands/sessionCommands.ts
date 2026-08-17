import * as vscode from "vscode";
import { PullRequestItem } from "../../../views/pullRequestProvider";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

const PULL_REQUEST_CONTEXT_CONTAINER = "workbench.view.extension.giteaPullRequestContext";

export function registerPullRequestSessionCommands(
  context: vscode.ExtensionContext,
  session: PullRequestSessionService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitea.activatePR",
      async (item: PullRequestItem) => {
        if (!(item instanceof PullRequestItem)) {
          return;
        }

        await session.activate(
          {
            key: item.repoInfo.key,
            owner: item.repoInfo.owner,
            name: item.repoInfo.repo,
            fullName: `${item.repoInfo.owner}/${item.repoInfo.repo}`,
          },
          item.pr,
        );

        await vscode.commands.executeCommand(PULL_REQUEST_CONTEXT_CONTAINER);
        await vscode.commands.executeCommand("gitea.viewActivePRDetail");
      },
    ),
    vscode.commands.registerCommand("gitea.clearActivePR", async () => {
      await session.clear();
    }),
    vscode.commands.registerCommand("gitea.cancelCreatePR", async () => {
      if (session.current.kind === "creating") {
        await session.clear();
      }
    }),
    vscode.commands.registerCommand("gitea.finishPostMerge", async () => {
      if (session.current.kind === "merged") {
        await session.clear();
      }
    }),
  );
}
