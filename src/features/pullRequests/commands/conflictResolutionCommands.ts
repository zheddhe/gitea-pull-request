import * as vscode from "vscode";
import { RepoManager } from "../../../context/repoManager";
import { ConflictResolutionService } from "../services/conflictResolutionService";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

const MERGE_IN_PROGRESS_CONTEXT = "gitea.conflictResolution.inProgress";

export function registerConflictResolutionCommands(
  context: vscode.ExtensionContext,
  repoManager: RepoManager,
  session: PullRequestSessionService,
  conflictResolution: ConflictResolutionService,
): void {
  void vscode.commands.executeCommand("setContext", MERGE_IN_PROGRESS_CONTEXT, false);

  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.prepareConflictResolution", async () => {
      const active = activeContext(repoManager, session);
      if (!active) {
        vscode.window.showWarningMessage(
          "No active Gitea pull request is available for conflict resolution.",
        );
        return;
      }

      if (active.pullRequest.mergeable !== false) {
        vscode.window.showWarningMessage(
          `PR #${active.pullRequest.number} is not currently reported by Gitea as non-mergeable. Refresh the pull request before preparing conflict resolution.`,
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Prepare conflict resolution for PR #${active.pullRequest.number}? This will fetch the latest remote branches, check out '${active.pullRequest.head.ref}', and merge the latest '${active.pullRequest.base.ref}' into it.`,
        { modal: true },
        "Prepare Conflict Resolution",
      );
      if (confirm !== "Prepare Conflict Resolution") return;

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Preparing conflict resolution for PR #${active.pullRequest.number}...`,
          },
          () => conflictResolution.prepare(active.repoInfo, active.pullRequest),
        );

        await session.setCheckoutState({
          kind: "checkedOut",
          localBranch: result.sourceBranch,
        });

        if (result.kind === "conflicts") {
          await vscode.commands.executeCommand(
            "setContext",
            MERGE_IN_PROGRESS_CONTEXT,
            true,
          );
          const fileSummary =
            result.conflictedFiles.length === 1
              ? "1 conflicted file"
              : `${result.conflictedFiles.length} conflicted files`;
          vscode.window.showWarningMessage(
            `Conflict resolution prepared for PR #${active.pullRequest.number}: ${fileSummary}. Resolve the conflicts in Source Control / Merge Editor, stage the resolved files, commit the merge, push the source branch, then refresh the pull request.`,
          );
          return;
        }

        await vscode.commands.executeCommand(
          "setContext",
          MERGE_IN_PROGRESS_CONTEXT,
          false,
        );
        vscode.window.showInformationMessage(
          `The latest ${result.baseRef} integrated cleanly into '${result.sourceBranch}'. Push the source branch, then refresh the pull request before merging it on Gitea.`,
        );
      } catch (error) {
        const inspection = await conflictResolution
          .inspect(active.repoInfo)
          .catch(() => undefined);
        await vscode.commands.executeCommand(
          "setContext",
          MERGE_IN_PROGRESS_CONTEXT,
          inspection?.mergeInProgress === true,
        );
        vscode.window.showErrorMessage(
          `Unable to prepare conflict resolution: ${(error as Error).message}`,
        );
      }
    }),
    vscode.commands.registerCommand("gitea.abortConflictResolution", async () => {
      const active = activeContext(repoManager, session);
      if (!active) {
        vscode.window.showWarningMessage(
          "No active Gitea pull request is available for conflict resolution.",
        );
        return;
      }

      const inspection = await conflictResolution.inspect(active.repoInfo);
      if (!inspection.mergeInProgress) {
        await vscode.commands.executeCommand(
          "setContext",
          MERGE_IN_PROGRESS_CONTEXT,
          false,
        );
        vscode.window.showInformationMessage("No Git merge is currently in progress.");
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Abort the in-progress Git merge for PR #${active.pullRequest.number}?`,
        { modal: true },
        "Abort Merge",
      );
      if (confirm !== "Abort Merge") return;

      try {
        await conflictResolution.abort(active.repoInfo);
        await vscode.commands.executeCommand(
          "setContext",
          MERGE_IN_PROGRESS_CONTEXT,
          false,
        );
        vscode.window.showInformationMessage(
          `Conflict-resolution merge aborted for PR #${active.pullRequest.number}.`,
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Unable to abort conflict resolution: ${(error as Error).message}`,
        );
      }
    }),
  );
}

function activeContext(
  repoManager: RepoManager,
  session: PullRequestSessionService,
) {
  const state = session.current;
  if (state.kind !== "active") return undefined;
  const repoInfo = repoManager
    .getRepos()
    .find((repo) => repo.key === state.repository.key);
  if (!repoInfo) return undefined;
  return { repoInfo, pullRequest: state.pullRequest };
}
