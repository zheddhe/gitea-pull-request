import * as vscode from "vscode";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { IssueCreationSessionService } from "../services/issueCreationSessionService";

export class CreateIssueViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.createIssue";

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly repoManager: RepoManager,
    private readonly session: IssueCreationSessionService,
  ) {
    this.disposables.push(
      this.session.onDidChangeState(() => this.render()),
      this.repoManager.onDidChange(() => {
        void this.handleRepositoriesChanged();
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };
    this.render();
  }

  async start(): Promise<void> {
    if (this.session.current.kind === "creating") {
      this.render();
      await vscode.commands.executeCommand(`${CreateIssueViewProvider.viewType}.focus`);
      return;
    }

    const repoInfo = await this.pickRepository();
    if (!repoInfo) return;

    await this.session.start(this.repositoryRef(repoInfo));
    this.render();
    await vscode.commands.executeCommand(`${CreateIssueViewProvider.viewType}.focus`);
  }

  async refresh(): Promise<void> {
    if (this.session.current.kind !== "creating") return;
    await this.handleRepositoriesChanged();
    this.render();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private async handleRepositoriesChanged(): Promise<void> {
    await this.session.invalidateIfRepositoryUnavailable(
      this.repoManager.getRepos().map((repo) => repo.key),
    );
  }

  private async pickRepository(): Promise<RepoInfo | undefined> {
    const repos = this.repoManager.getRepos();
    if (repos.length === 0) {
      vscode.window.showErrorMessage("No Gitea repositories detected.");
      return undefined;
    }
    if (repos.length === 1) return repos[0];

    const selected = await vscode.window.showQuickPick(
      repos.map((repoInfo) => ({
        label: repoInfo.label,
        description: repoInfo.serverUrl,
        detail: repoInfo.currentBranch
          ? `Current branch: ${repoInfo.currentBranch}`
          : undefined,
        repoInfo,
      })),
      { placeHolder: "Select the Gitea repository for the new issue" },
    );
    return selected?.repoInfo;
  }

  private repositoryRef(repoInfo: RepoInfo) {
    return {
      key: repoInfo.key,
      owner: repoInfo.owner,
      name: repoInfo.repo,
      fullName: repoInfo.label,
    };
  }

  private render(): void {
    if (!this.view) return;

    const state = this.session.current;
    if (state.kind !== "creating") {
      this.view.webview.html = this.emptyHtml();
      return;
    }

    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  body {
    padding: 12px;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
  }
  .card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 12px;
    background: var(--vscode-sideBar-background);
  }
  h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
  p { margin: 6px 0; line-height: 1.45; }
  .repo { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <section class="card">
    <h2>Create Issue</h2>
    <p class="repo">Repository: ${escapeHtml(state.repository.fullName)}</p>
    <p>The sidebar authoring workspace is active. Title, description, templates and metadata are added in the next implementation slices.</p>
  </section>
</body>
</html>`;
  }

  private emptyHtml(): string {
    return `<!doctype html><html><body></body></html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
