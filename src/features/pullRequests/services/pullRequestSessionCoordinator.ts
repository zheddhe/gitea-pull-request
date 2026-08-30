import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { debug, info, warn } from "../../../debug/outputChannel";
import { PRDiffProvider } from "../../../views/prDiffProvider";
import { PullRequestWorkspaceState } from "../domain/pullRequestState";
import { PullRequestSessionService } from "./pullRequestSessionService";
import { ReviewedFileStateService } from "./reviewedFileStateService";

export class PullRequestSessionCoordinator implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly reviewedFiles: ReviewedFileStateService,
  ) {
    this.disposables.push(
      this.session.onDidChangeState((state) => {
        void this.applySessionState(state);
      }),
      this.repoManager.onDidChange((repos) => {
        void this.handleRepositoriesChanged(repos);
      }),
    );
  }

  async initialize(): Promise<void> {
    await this.handleRepositoriesChanged(this.repoManager.getRepos());
    await this.applySessionState(this.session.current);
  }

  dispose(): void {
    PRDiffProvider.clearAll();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleRepositoriesChanged(repos: RepoInfo[]): Promise<void> {
    debug(`[pr-coordinator] repositories changed count=${repos.length}`);
    await this.session.invalidateIfRepositoryUnavailable(repos.map((repo) => repo.key));
  }

  private async applySessionState(state: PullRequestWorkspaceState): Promise<void> {
    if (state.kind !== "active") {
      debug(`[pr-coordinator] state=${state.kind}; clearing contextual diff`);
      PRDiffProvider.clearAll();
      await vscode.commands.executeCommand("setContext", "gitea.prDiffVisible", false);
      return;
    }

    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);

    if (!repoInfo) {
      warn(`[pr-coordinator] active repository missing key=${state.repository.key}; clearing session`);
      await this.session.clear();
      return;
    }

    debug(`[pr-coordinator] bind diff repo=${repoInfo.label} pr=#${state.pullRequest.number}`);
    await vscode.commands.executeCommand("setContext", "gitea.prDiffVisible", true);
    await PRDiffProvider.show(this.api, repoInfo, state.pullRequest);
    const provider = PRDiffProvider.getActive();
    if (!provider) return;
    const filenames = await this.reviewedFiles.reconcile(repoInfo, state.pullRequest);
    info(
      `[reviewed-files] session restore repo=${repoInfo.key} pr=#${state.pullRequest.number} head=${state.pullRequest.head.sha.slice(0, 8)} restored=${filenames.length}`,
    );
    for (const filename of filenames) provider.markViewed(filename);
  }
}
