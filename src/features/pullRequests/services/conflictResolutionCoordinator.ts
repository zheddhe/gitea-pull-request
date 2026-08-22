import * as vscode from "vscode";
import { RepoManager } from "../../../context/repoManager";
import { PullRequestSessionService } from "./pullRequestSessionService";

export class ConflictResolutionCoordinator implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;
  private lastOfferedIdentity: string | undefined;

  constructor(
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
  ) {
    this.disposable = this.session.onDidChangeState((state) => {
      if (state.kind !== "active") {
        this.lastOfferedIdentity = undefined;
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
      state.pullRequest.number !== pullRequestNumber ||
      state.pullRequest.mergeable !== false
    ) {
      return;
    }

    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === repositoryKey);
    if (!repoInfo) return;

    const identity = `${repositoryKey}#${pullRequestNumber}@${state.pullRequest.head.sha}`;
    if (identity === this.lastOfferedIdentity) return;
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
