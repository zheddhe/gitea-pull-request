import * as vscode from "vscode";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { RepoManager } from "../../../context/repoManager";
import type { PullRequestProvider } from "../../../views/pullRequestProvider";
import { debug, error as logError } from "../../../debug/outputChannel";
import type { PullRequestSessionService } from "../services/pullRequestSessionService";

export function registerRefreshActivePullRequestCommand(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  repoManager: RepoManager,
  session: PullRequestSessionService,
  prProvider: PullRequestProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.refreshActivePR", async () => {
      const state = session.current;
      if (state.kind !== "active") {
        return;
      }

      const repoInfo = repoManager
        .getRepos()
        .find((repo) => repo.key === state.repository.key);
      if (!repoInfo) {
        vscode.window.showWarningMessage(
          "The repository for the active Gitea pull request is no longer available.",
        );
        return;
      }

      try {
        debug(
          `[pr-refresh] refreshing active PR repo=${repoInfo.label} pr=#${state.pullRequest.number}`,
        );
        const pullRequest = await api.getPullRequest(
          repoInfo,
          state.pullRequest.number,
        );
        await session.activate(
          state.repository,
          pullRequest,
          state.checkoutState,
        );
        prProvider.refresh();
        debug(
          `[pr-refresh] refreshed active PR repo=${repoInfo.label} pr=#${pullRequest.number} head=${pullRequest.head.sha}`,
        );
      } catch (error) {
        logError(`[pr-refresh] failed: ${(error as Error).message}`);
        vscode.window.showErrorMessage(
          `Unable to refresh active pull request: ${(error as Error).message}`,
        );
      }
    }),
  );
}
