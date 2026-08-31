import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { RepositoryMetadataApi } from "../../../api/repositoryMetadataApi";
import type { GiteaLabel, GiteaMilestone, GiteaUser } from "../../../api/types";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import type { IssueTemplate } from "../domain/issueTemplate";
import { IssueCreationSessionService } from "../services/issueCreationSessionService";
import { IssueTemplateService } from "../services/issueTemplateService";

interface CreateIssueDraft {
  repoInfo: RepoInfo;
  title: string;
  body: string;
  assignees: GiteaUser[];
  labels: GiteaLabel[];
  milestone?: GiteaMilestone;
  templates: IssueTemplate[];
  template?: IssueTemplate;
  defaultBranch?: string;
}

interface FormSnapshot {
  title: string;
  body: string;
}

type CreateIssueViewMessage =
  | ({ type: "updateForm" } & FormSnapshot)
  | ({ type: "changeRepository" } & FormSnapshot)
  | ({ type: "pickTemplate" } & FormSnapshot)
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
    private readonly templateService: IssueTemplateService,
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
    const discovery = await this.discoverTemplates(repoInfo);

    this.draft = {
      repoInfo,
      title: "",
      body: "",
      assignees: [],
      labels: [],
      templates: discovery.templates,
      defaultBranch: discovery.defaultBranch,
    };
    await this.session.start(this.repositoryRef(repoInfo));
    this.render();
    await vscode.commands.executeCommand(`${CreateIssueViewProvider.viewType}.focus`);
  }

  async refresh(): Promise<void> {
    if (!this.draft || this.session.current.kind !== "creating") return;
    await this.handleRepositoriesChanged();
    if (!this.draft) return;

    const discovery = await this.discoverTemplates(this.draft.repoInfo, false);
    this.draft.templates = discovery.templates;
    this.draft.defaultBranch = discovery.defaultBranch;
    if (
      this.draft.template &&
      !discovery.templates.some((template) => template.id === this.draft?.template?.id)
    ) {
      this.draft.template = undefined;
    }
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
      case "pickTemplate":
        await this.pickTemplate();
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
    const discovery = await this.discoverTemplates(repoInfo);

    // Portable author input is retained; repository-bound state is reset.
    this.draft.repoInfo = repoInfo;
    this.draft.assignees = [];
    this.draft.labels = [];
    this.draft.milestone = undefined;
    this.draft.template = undefined;
    this.draft.templates = discovery.templates;
    this.draft.defaultBranch = discovery.defaultBranch;
    await this.session.start(this.repositoryRef(repoInfo));
    this.render();
  }

  private async pickTemplate(): Promise<void> {
    if (!this.draft) return;
    const blank = {
      label: "$(file) Blank issue",
      description: "Keep the current authoring draft without a template",
      template: undefined as IssueTemplate | undefined,
    };
    const selected = await vscode.window.showQuickPick(
      [
        blank,
        ...this.draft.templates.map((template) => ({
          label: template.name,
          description: template.about,
          detail: template.id,
          template,
        })),
      ],
      { placeHolder: "Select an issue template" },
    );
    if (!selected) return;
    if (!selected.template) {
      this.draft.template = undefined;
      this.render();
      return;
    }

    await this.applyTemplate(selected.template);
  }

  private async applyTemplate(template: IssueTemplate): Promise<void> {
    if (!this.draft) return;
    this.draft.template = template;
    this.draft.title = template.title;
    this.draft.body = template.body;

    try {
      const [users, labels] = await Promise.all([
        this.metadataApi.listAssignees(this.draft.repoInfo),
        this.metadataApi.listLabels(this.draft.repoInfo),
      ]);
      const assigneeNames = new Set(template.assigneeNames.map((value) => value.toLowerCase()));
      const labelNames = new Set(template.labelNames.map((value) => value.toLowerCase()));
      this.draft.assignees = users.filter((user) =>
        assigneeNames.has(user.login.toLowerCase()),
      );
      this.draft.labels = labels.filter((label) =>
        labelNames.has(label.name.toLowerCase()),
      );
    } catch (error) {
      this.showMetadataError("template metadata", error);
    }
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
    try {
      const issue = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating issue in ${repoInfo.label}...`,
        },
        () =>
          this.api.createIssue(repoInfo, {
            title,
            body,
            assignees: assignees.map((user) => user.login),
            labels: labels.map((label) => label.id),
            milestone: milestone?.id,
          }),
      );

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
  }

  private async discoverTemplates(
    repoInfo: RepoInfo,
    notify = true,
  ): Promise<{ templates: IssueTemplate[]; defaultBranch?: string }> {
    try {
      const discovery = await this.templateService.discover(repoInfo);
      return discovery;
    } catch (error) {
      if (notify) {
        vscode.window.showWarningMessage(
          `Unable to load issue templates: ${(error as Error).message}`,
        );
      }
      return { templates: [] };
    }
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

    const {
      repoInfo,
      title,
      body,
      assignees,
      labels,
      milestone,
      template,
      templates,
      defaultBranch,
    } = this.draft;
    const chips = (values: string[], emptyLabel = "None selected") =>
      values.length > 0
        ? values.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("")
        : `<span class="metadata-empty">${escapeHtml(emptyLabel)}</span>`;

    const templateValue = template
      ? template.name
      : templates.length > 0
        ? "Blank issue"
        : "Blank issue · no templates found";
    const templateHint = defaultBranch
      ? `Templates from ${defaultBranch}`
      : "Template discovery unavailable";

    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; }
  body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.45; }
  .repo-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .repo { flex: 1; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; }
  .section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--vscode-panel-border); }
  .section:first-of-type { margin-top: 0; border-top: 0; padding-top: 0; }
  .section-title { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; font-weight: 600; }
  .form-card { border: 1px solid var(--vscode-panel-border); border-radius: 3px; overflow: hidden; }
  .form-field { padding: 9px 10px; }
  .form-field + .form-field { border-top: 1px solid var(--vscode-panel-border); }
  input, textarea { width: 100%; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; }
  input:focus-visible, textarea:focus-visible, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  textarea { min-height: 120px; resize: vertical; }
  .metadata-list { display: grid; gap: 7px; }
  .metadata-row { border: 1px solid var(--vscode-panel-border); border-radius: 3px; overflow: hidden; }
  .metadata-picker { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; padding: 7px 9px; color: var(--vscode-foreground); background: var(--vscode-textBlockQuote-background, var(--vscode-editor-inactiveSelectionBackground)); cursor: pointer; text-align: left; }
  .metadata-picker .name { font-weight: 600; }
  .metadata-picker .chevron { color: var(--vscode-descriptionForeground); }
  .metadata-values { display: flex; gap: 5px; flex-wrap: wrap; padding: 7px 9px; border-top: 1px solid var(--vscode-panel-border); min-height: 30px; align-items: center; }
  .chip { display: inline-flex; align-items: center; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 999px; padding: 1px 7px; font-size: .88em; }
  .metadata-empty { color: var(--vscode-descriptionForeground); font-size: .9em; }
  .template-hint { color: var(--vscode-descriptionForeground); font-size: .85em; margin-left: 4px; }
  .actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
  button { font: inherit; border: 1px solid transparent; padding: 6px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
</style>
</head>
<body>
  <div class="repo-row">
    <div class="repo">${escapeHtml(repoInfo.label)} · ${escapeHtml(repoInfo.serverUrl)}</div>
    <button id="changeRepository" class="secondary" type="button">Change</button>
  </div>

  <section class="section">
    <div class="section-title">Template <span class="template-hint">${escapeHtml(templateHint)}</span></div>
    <div class="metadata-row"><button class="metadata-picker" data-action="pickTemplate"><span class="name">${escapeHtml(templateValue)}</span><span class="chevron">›</span></button></div>
  </section>

  <section class="section">
    <div class="section-title">General information</div>
    <div class="form-card">
      <div class="form-field"><input id="title" aria-label="Issue title" value="${escapeHtml(title)}" placeholder="Issue title"></div>
      <div class="form-field"><textarea id="body" aria-label="Issue description" placeholder="Issue description (Markdown)">${escapeHtml(body)}</textarea></div>
    </div>
  </section>

  <section class="section metadata">
    <div class="section-title">Metadata</div>
    <div class="metadata-list">
      <div class="metadata-row"><button class="metadata-picker" data-action="pickAssignees"><span class="name">Assignees</span><span class="chevron">›</span></button><div class="metadata-values">${chips(assignees.map((user) => user.login))}</div></div>
      <div class="metadata-row"><button class="metadata-picker" data-action="pickLabels"><span class="name">Labels</span><span class="chevron">›</span></button><div class="metadata-values">${chips(labels.map((label) => label.name))}</div></div>
      <div class="metadata-row"><button class="metadata-picker" data-action="pickMilestone"><span class="name">Milestone</span><span class="chevron">›</span></button><div class="metadata-values">${chips(milestone ? [milestone.title] : [])}</div></div>
    </div>
  </section>

  <div class="actions"><button id="create" type="button">Create</button></div>
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
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => post(button.dataset.action)));
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
