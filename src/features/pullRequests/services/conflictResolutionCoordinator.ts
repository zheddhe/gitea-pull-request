import * as vscode from "vscode";
import type { GiteaCombinedStatus } from "../../../api/types";
import { RepoManager } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";
import { ConflictResolutionService } from "./conflictResolutionService";
import { PullRequestReviewApi } from "./pullRequestReviewApi";
import { PullRequestSessionService } from "./pullRequestSessionService";

const MERGE_IN_PROGRESS_CONTEXT = "gitea.conflictResolution.inProgress";

export function hasPendingChecks(status: GiteaCombinedStatus): boolean {
  if (status.statuses.some((check) => check.state === "pending")) {
    return true;
  }
  return status.total_count > 0 && status.state === "pending";
}

export class ConflictResolutionCoordinator implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  private lastOfferedIdentity: string | undefined;

  constructor(
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly conflictResolution: ConflictResolutionService,
    private readonly reviewApi: PullRequestReviewApi,
  ) {
    this.disposable = this.session.onDidChangeState((state) => {
      if (state.kind !== "active") {
        this.lastOfferedIdentity = undefined;
        void vscode.commands.executeCommand(
          "setContext",
          MERGE_IN_PROGRESS_CONTEXT,
          false,
        );
        return;
      }
      void this.offerIfBlocked(state.repository.key, state.pullRequest.number);
    });
  }

  async initialize(): Promise<void> {
    const state = this.session.current;
    if (state.kind !== "active") return;
    await this.offerIfBlocked(state.repository.key, state.pullRequest.number);
  }

  dispose(): void {
    this.disposable.dispose();
  }

  private async offerIfBlocked(
    repositoryKey: string,
    pullRequestNumber: number,
  ): Promise<void> {
    const state = this.session.current;
    if (
      state.kind !== "active" ||
      state.repository.key !== repositoryKey ||
      state.pullRequest.number !== pullRequestNumber
    ) {
      return;
    }

    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === repositoryKey);
    if (!repoInfo) return;

    const inspection = await this.conflictResolution.inspect(repoInfo).catch(() => undefined);
    await vscode.commands.executeCommand(
      "setContext",
      MERGE_IN_PROGRESS_CONTEXT,
      inspection?.mergeInProgress === true,
    );

    const identity = `${repositoryKey}#${pullRequestNumber}@${state.pullRequest.head.sha}`;
    if (identity === this.lastOfferedIdentity) return;

    if (inspection?.mergeInProgress) {
      this.lastOfferedIdentity = identity;
      const action = await vscode.window.showWarningMessage(
        `A Git merge is already in progress while reviewing PR #${pullRequestNumber}. Continue resolving it in Source Control / Merge Editor, or abort the prepared merge.`,
        "Open Source Control",
        "Abort Merge",
      );
      if (action === "Open Source Control") {
        await vscode.commands.executeCommand("workbench.view.scm");
      } else if (action === "Abort Merge") {
        await vscode.commands.executeCommand("gitea.abortConflictResolution");
      }
      return;
    }

    if (state.pullRequest.mergeable !== false) return;

    try {
      const status = await this.reviewApi.getCombinedStatus(
        repoInfo,
        state.pullRequest.head.sha,
      );
      if (hasPendingChecks(status)) {
        log(
          `[conflict-resolution] guidance suppressed repo=${repoInfo.label} pr=#${pullRequestNumber} reason=ci-pending`,
        );
        return;
      }
    } catch (error) {
      log(
        `[conflict-resolution] unable to verify CI state before guidance repo=${repoInfo.label} pr=#${pullRequestNumber}: ${(error as Error).message}`,
      );
    }

    this.lastOfferedIdentity = identity;
    const action = await vscode.window.showWarningMessage(
      `PR #${pullRequestNumber} is not automatically mergeable. You can prepare a local Git merge of the latest base into '${state.pullRequest.head.ref}' to materialize and resolve any real conflicts safely.`,
      "Prepare Conflict Resolution",
    );
    if (action === "Prepare Conflict Resolution") {
      await vscode.commands.executeCommand("gitea.prepareConflictResolution");
    }
  }
}
