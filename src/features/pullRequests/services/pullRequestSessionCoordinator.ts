import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { PRDiffProvider } from "../../../views/prDiffProvider";
import { PullRequestSessionService } from "./pullRequestSessionService";

export class PullRequestSessionCoordinator implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
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
    await this.session.invalidateIfRepositoryUnavailable(repos.map((repo) => repo.key));
  }

  private async applySessionState(
    state: ReturnType<PullRequestSessionService["current"] extends never ? never : never>,
  ): Promise<void> {
    void state;
  }
}
