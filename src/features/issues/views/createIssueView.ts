import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { IssueCreationSessionService } from "../services/issueCreationSessionService";

interface CreateIssueDraft {
  repoInfo: RepoInfo;
  title: string;
  body: string;
}

interface FormSnapshot {
  title: string;
  body: string;
}

type CreateIssueViewMessage =
  | ({ type: "updateForm" } & FormSnapshot)
  | ({ type: "changeRepository" } & FormSnapshot)
  | ({ type: "create" } & FormSnapshot);

export class CreateIssueViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.createIssue";

  private view: vscode.WebviewView | undefined;
  private draft: CreateIssueDraft | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly session: IssueCreationSessionService,
  ) {
    this.disposables.push(
      this.session.onDidChangeState((state) => {
        if (state.kind !== "creating") this.draft = undefined;
        this.render();
      }),
      this.repoManager.onDidChange(() => {
        void this.handleRepositoriesChanged();
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: CreateIssueViewMessage) =>
        this.handleMessage(message),
      ),
    );
    this.render();
  }

  async start(): Promise<void> {
    if (this.draft && this.session.current.kind === "creating") {
      this.render();
      await vscode.commands.executeCommand(`${CreateIssueViewProvider.viewType}.focus`);
      return;
    }

    const repoInfo = await this.pickRepository();
    if (!repoInfo) return;

    this.draft = { repoInfo, title: "", body: "" };
    await this.session.start(this.repositoryRef(repoInfo));
    this.render();
    await vscode.commands.executeCommand(`${CreateIssueViewProvider.viewType}.focus`);
  }

  async refresh(): Promise<void> {
    if (!this.draft || this.session.current.kind !== "creating") return;
    await this.handleRepositoriesChanged();
    this.render();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private async handleRepositoriesChanged(): Promise<void> {
    if (!this.draft) return;
    const repos = this.repoManager.getRepos();
    if (!repos.some((repo) => repo.key === this.draft?.repoInfo.key)) {
      this.draft = undefined;
      await this.session.clear();
    }
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
        repoInfo,
      })),
      { placeHolder: "Select the Gitea repository for the new issue" },
    );
    return selected?.repoInfo;
  }

  private async handleMessage(message: CreateIssueViewMessage): Promise<void> {
    if (!this.draft || this.session.current.kind !== "creating") return;
    this.draft.title = message.title;
    this.draft.body = message.body;

    switch (message.type) {
      case "updateForm":
        return;
      case "changeRepository":
        await this.changeRepository();
        return;
      case "create":
        await this.createIssue();
        return;
    }
  }

  private async changeRepository(): Promise<void> {
    if (!this.draft) return;
    const repoInfo = await this.pickRepository();
    if (!repoInfo) return;
    this.draft.repoInfo = repoInfo;
    await this.session.start(this.repositoryRef(repoInfo));
    this.render();
  }

  private async createIssue(): Promise<void> {
    if (!this.draft) return;
    const title = this.draft.title.trim();
    if (!title) {
      vscode.window.showWarningMessage("Issue title is required.");
      return;
    }

    const { repoInfo, body } = this.draft;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating issue in ${repoInfo.label}...`,
      },
      async () => {
        try {
          const issue = await this.api.createIssue(repoInfo, { title, body });
          await vscode.commands.executeCommand("gitea.refreshIssues");
          await this.session.clear();
          const action = await vscode.window.showInformationMessage(
            `Issue #${issue.number} created.`,
            "Open in Browser",
          );
          if (action === "Open in Browser") {
            await vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to create issue: ${(error as Error).message}`,
          );
        }
      },
    );
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
    if (!this.draft || this.session.current.kind !== "creating") {
      this.view.webview.html = "<!doctype html><html><body></body></html>";
      return;
    }

    const { repoInfo, title, body } = this.draft;
    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; background: var(--vscode-sideBar-background); }
  h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; }
  label { display: block; margin: 12px 0 5px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  input, textarea { width: 100%; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; }
  textarea { min-height: 150px; resize: vertical; }
  .repo-row { display: flex; align-items: center; gap: 8px; }
  .repo { flex: 1; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; }
  button { font: inherit; border: 0; padding: 6px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .actions { display: flex; justify-content: flex-end; margin-top: 12px; }
</style>
</head>
<body>
  <section class="card">
    <h2>Create Issue</h2>
    <div class="repo-row">
      <div class="repo">Repository: ${escapeHtml(repoInfo.label)}</div>
      <button id="changeRepository" class="secondary" type="button">Change</button>
    </div>
    <label for="title">Title</label>
    <input id="title" aria-label="Issue title" placeholder="Issue title" value="${escapeHtml(title)}" />
    <label for="body">Description</label>
    <textarea id="body" aria-label="Issue description" placeholder="Issue description (Markdown)">${escapeHtml(body)}</textarea>
    <div class="actions"><button id="create" type="button">Create Issue</button></div>
  </section>
<script>
  const vscode = acquireVsCodeApi();
  const title = document.getElementById('title');
  const body = document.getElementById('body');
  const snapshot = (type) => ({ type, title: title.value, body: body.value });
  const formChanged = () => vscode.postMessage(snapshot('updateForm'));
  title.addEventListener('input', formChanged);
  body.addEventListener('input', formChanged);
  document.getElementById('changeRepository').addEventListener('click', () => vscode.postMessage(snapshot('changeRepository')));
  document.getElementById('create').addEventListener('click', () => vscode.postMessage(snapshot('create')));
</script>
</body>
</html>`;
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
