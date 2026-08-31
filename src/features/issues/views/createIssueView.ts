import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { RepositoryMetadataApi } from "../../../api/repositoryMetadataApi";
import type { GiteaLabel, GiteaMilestone, GiteaUser } from "../../../api/types";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { IssueCreationSessionService } from "../services/issueCreationSessionService";

interface CreateIssueDraft {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  assignees: GiteaUser[];
  labels: GiteaLabel[];
  milestone?: GiteaMilestone;
}

interface FormSnapshot {
  title: string;
  body: string;
}

type CreateIssueViewMessage =
  | ({ type: "updateForm" } & FormSnapshot)
  | ({ type: "changeRepository" } & FormSnapshot)
  | ({ type: "pickAssignees" } & FormSnapshot)
  | ({ type: "pickLabels" } & FormSnapshot)
  | ({ type: "pickMilestone" } & FormSnapshot)
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
    private readonly metadataApi: RepositoryMetadataApi,
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

    this.draft = {
      repoInfo,
      title: "",
      body: "",
      assignees: [],
      labels: [],
    };
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
      case "pickAssignees":
        await this.pickAssignees();
        return;
      case "pickLabels":
        await this.pickLabels();
        return;
      case "pickMilestone":
        await this.pickMilestone();
        return;
      case "create":
        await this.createIssue();
        return;
    }
  }

  private async changeRepository(): Promise<void> {
    if (!this.draft) return;
    const repoInfo = await this.pickRepository();
    if (!repoInfo || repoInfo.key === this.draft.repoInfo.key) return;

    // Title/body are portable author input; repository metadata is not.
    this.draft.repoInfo = repoInfo;
    this.draft.assignees = [];
    this.draft.labels = [];
    this.draft.milestone = undefined;
    await this.session.start(this.repositoryRef(repoInfo));
    this.render();
  }

  private async pickAssignees(): Promise<void> {
    if (!this.draft) return;
    try {
      const users = await this.metadataApi.listAssignees(this.draft.repoInfo);
      const selected = await vscode.window.showQuickPick(
        users.map((user) => ({
          label: user.login,
          description: user.full_name || undefined,
          picked: this.draft?.assignees.some((item) => item.login === user.login),
          user,
        })),
        { canPickMany: true, placeHolder: "Select issue assignees" },
      );
      if (selected) {
        this.draft.assignees = selected.map((item) => item.user);
        this.render();
      }
    } catch (error) {
      this.showMetadataError("assignees", error);
    }
  }

  private async pickLabels(): Promise<void> {
    if (!this.draft) return;
    try {
      const labels = await this.metadataApi.listLabels(this.draft.repoInfo);
      const selected = await vscode.window.showQuickPick(
        labels.map((label) => ({
          label: label.name,
          description: `#${label.color}`,
          picked: this.draft?.labels.some((item) => item.id === label.id),
          giteaLabel: label,
        })),
        { canPickMany: true, placeHolder: "Select issue labels" },
      );
      if (selected) {
        this.draft.labels = selected.map((item) => item.giteaLabel);
        this.render();
      }
    } catch (error) {
      this.showMetadataError("labels", error);
    }
  }

  private async pickMilestone(): Promise<void> {
    if (!this.draft) return;
    try {
      const milestones = await this.metadataApi.listMilestones(this.draft.repoInfo);
      const selected = await vscode.window.showQuickPick(
        [
          {
            label: "$(circle-slash) No milestone",
            milestone: undefined as GiteaMilestone | undefined,
          },
          ...milestones.map((milestone) => ({ label: milestone.title, milestone })),
        ],
        { placeHolder: "Select an issue milestone" },
      );
      if (selected) {
        this.draft.milestone = selected.milestone;
        this.render();
      }
    } catch (error) {
      this.showMetadataError("milestones", error);
    }
  }

  private async createIssue(): Promise<void> {
    if (!this.draft) return;
    const title = this.draft.title.trim();
    if (!title) {
      vscode.window.showWarningMessage("Issue title is required.");
      return;
    }

    const { repoInfo, body, assignees, labels, milestone } = this.draft;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating issue in ${repoInfo.label}...`,
      },
      async () => {
        try {
          const issue = await this.api.createIssue(repoInfo, {
            title,
            body,
            assignees: assignees.map((user) => user.login),
            labels: labels.map((label) => label.id),
            milestone: milestone?.id,
          });
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

  private showMetadataError(kind: string, error: unknown): void {
    vscode.window.showErrorMessage(
      `Unable to load issue ${kind}: ${(error as Error).message}`,
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

    const { repoInfo, title, body, assignees, labels, milestone } = this.draft;
    const chips = (values: string[], emptyLabel = "None selected") =>
      values.length > 0
        ? values.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("")
        : `<span class="metadata-empty">${escapeHtml(emptyLabel)}</span>`;

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
  label, .metadata-label { display: block; margin: 12px 0 5px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  input, textarea { width: 100%; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; }
  textarea { min-height: 150px; resize: vertical; }
  .repo-row, .metadata-row { display: flex; align-items: center; gap: 8px; }
  .repo, .metadata-values { flex: 1; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; }
  .metadata-values { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 2px 7px; color: var(--vscode-foreground); }
  .metadata-empty { opacity: .75; }
  button { font: inherit; border: 0; padding: 6px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .actions { display: flex; justify-content: flex-end; margin-top: 14px; }
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

    <span class="metadata-label">Assignees</span>
    <div class="metadata-row"><div class="metadata-values">${chips(assignees.map((user) => user.login))}</div><button id="pickAssignees" class="secondary" type="button">Select</button></div>
    <span class="metadata-label">Labels</span>
    <div class="metadata-row"><div class="metadata-values">${chips(labels.map((label) => label.name))}</div><button id="pickLabels" class="secondary" type="button">Select</button></div>
    <span class="metadata-label">Milestone</span>
    <div class="metadata-row"><div class="metadata-values">${chips(milestone ? [milestone.title] : [], "No milestone")}</div><button id="pickMilestone" class="secondary" type="button">Select</button></div>

    <div class="actions"><button id="create" type="button">Create Issue</button></div>
  </section>
<script>
  const vscode = acquireVsCodeApi();
  const title = document.getElementById('title');
  const body = document.getElementById('body');
  const snapshot = (type) => ({ type, title: title.value, body: body.value });
  const post = (type) => vscode.postMessage(snapshot(type));
  const formChanged = () => post('updateForm');
  title.addEventListener('input', formChanged);
  body.addEventListener('input', formChanged);
  document.getElementById('changeRepository').addEventListener('click', () => post('changeRepository'));
  document.getElementById('pickAssignees').addEventListener('click', () => post('pickAssignees'));
  document.getElementById('pickLabels').addEventListener('click', () => post('pickLabels'));
  document.getElementById('pickMilestone').addEventListener('click', () => post('pickMilestone'));
  document.getElementById('create').addEventListener('click', () => post('create'));
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
