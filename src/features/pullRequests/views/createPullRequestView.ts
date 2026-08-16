import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { PullRequestMetadataApi } from "../../../api/pullRequestMetadataApi";
import type { GiteaLabel, GiteaMilestone, GiteaUser } from "../../../api/types";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { PullRequestProvider } from "../../../views/pullRequestProvider";
import {
  draftTitle,
  suggestTitleFromBranch,
  validBranchPair,
} from "../domain/createPullRequestModel";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

interface CreateDraft {
  repoInfo: RepoInfo;
  branches: string[];
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  assignees: GiteaUser[];
  reviewers: GiteaUser[];
  labels: GiteaLabel[];
  milestone?: GiteaMilestone;
}

interface FormSnapshot {
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}

type CreateViewMessage =
  | ({ type: "changeBranches" } & FormSnapshot)
  | ({ type: "pickAssignees" } & FormSnapshot)
  | ({ type: "pickReviewers" } & FormSnapshot)
  | ({ type: "pickLabels" } & FormSnapshot)
  | ({ type: "pickMilestone" } & FormSnapshot)
  | ({ type: "create"; draft: boolean } & FormSnapshot)
  | { type: "cancel" }
  | { type: "openLegacy" };

export class CreatePullRequestViewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  static readonly viewType = "gitea.createPullRequest";

  private view: vscode.WebviewView | undefined;
  private draft: CreateDraft | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly api: GiteaApiClient,
    private readonly metadataApi: PullRequestMetadataApi,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly prProvider: PullRequestProvider,
  ) {
    this.disposables.push(
      this.session.onDidChangeState(() => this.render()),
      this.repoManager.onDidChange(() => {
        if (
          this.draft &&
          !this.repoManager.getRepos().some((repo) => repo.key === this.draft?.repoInfo.key)
        ) {
          this.draft = undefined;
          this.render();
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: CreateViewMessage) =>
        this.handleMessage(message),
      ),
    );
    this.render();
  }

  async start(): Promise<void> {
    if (this.draft && this.session.current.kind === "creating") {
      this.render();
      await vscode.commands.executeCommand(`${CreatePullRequestViewProvider.viewType}.focus`);
      return;
    }

    const repoInfo = await this.pickRepository();
    if (!repoInfo) {
      return;
    }

    let branches: string[];
    try {
      branches = await this.api.listBranches(repoInfo);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Unable to load Gitea branches: ${(error as Error).message}`,
      );
      return;
    }

    if (branches.length < 2) {
      vscode.window.showWarningMessage(
        `At least two branches are required to create a pull request in ${repoInfo.label}.`,
      );
      return;
    }

    const headBranch =
      (repoInfo.currentBranch && branches.includes(repoInfo.currentBranch)
        ? repoInfo.currentBranch
        : branches[0]) ?? branches[0];
    const baseBranch = this.pickDefaultBase(branches, headBranch);

    this.draft = {
      repoInfo,
      branches,
      baseBranch,
      headBranch,
      title: suggestTitleFromBranch(headBranch),
      body: "",
      assignees: [],
      reviewers: [],
      labels: [],
    };

    await this.session.startCreating(
      this.repositoryRef(repoInfo),
      baseBranch,
      headBranch,
    );

    this.render();
    await vscode.commands.executeCommand(`${CreatePullRequestViewProvider.viewType}.focus`);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private async pickRepository(): Promise<RepoInfo | undefined> {
    const repos = this.repoManager.getRepos();
    if (repos.length === 0) {
      vscode.window.showErrorMessage("No Gitea repositories detected.");
      return undefined;
    }
    if (repos.length === 1) {
      return repos[0];
    }

    const selected = await vscode.window.showQuickPick(
      repos.map((repoInfo) => ({
        label: repoInfo.label,
        description: repoInfo.serverUrl,
        detail: repoInfo.currentBranch
          ? `Current branch: ${repoInfo.currentBranch}`
          : undefined,
        repoInfo,
      })),
      { placeHolder: "Select the Gitea repository for the new pull request" },
    );
    return selected?.repoInfo;
  }

  private pickDefaultBase(branches: string[], headBranch: string): string {
    for (const candidate of ["main", "master"]) {
      if (candidate !== headBranch && branches.includes(candidate)) {
        return candidate;
      }
    }
    return branches.find((branch) => branch !== headBranch) ?? branches[0];
  }

  private async handleMessage(message: CreateViewMessage): Promise<void> {
    if (message.type === "cancel") {
      this.draft = undefined;
      await this.session.clear();
      return;
    }

    if (message.type === "openLegacy") {
      await this.session.clear();
      this.draft = undefined;
      await vscode.commands.executeCommand("gitea.createPR");
      return;
    }

    if (!this.draft) {
      return;
    }

    this.applyForm(message);

    switch (message.type) {
      case "changeBranches":
        await this.changeBranches(message);
        return;
      case "pickAssignees":
        await this.pickAssignees();
        return;
      case "pickReviewers":
        await this.pickReviewers();
        return;
      case "pickLabels":
        await this.pickLabels();
        return;
      case "pickMilestone":
        await this.pickMilestone();
        return;
      case "create":
        await this.create(message.draft);
        return;
    }
  }

  private applyForm(message: Exclude<CreateViewMessage, { type: "cancel" } | { type: "openLegacy" }>): void {
    if (!this.draft) {
      return;
    }
    this.draft.baseBranch = message.baseBranch;
    this.draft.headBranch = message.headBranch;
    this.draft.title = message.title;
    this.draft.body = message.body;
  }

  private async changeBranches(message: FormSnapshot): Promise<void> {
    if (!this.draft) {
      return;
    }
    if (
      !this.draft.branches.includes(message.baseBranch) ||
      !this.draft.branches.includes(message.headBranch) ||
      !validBranchPair(message.baseBranch, message.headBranch)
    ) {
      return;
    }
    await this.session.startCreating(
      this.repositoryRef(this.draft.repoInfo),
      message.baseBranch,
      message.headBranch,
    );
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
        { canPickMany: true, placeHolder: "Select pull request assignees" },
      );
      if (selected) {
        this.draft.assignees = selected.map((item) => item.user);
        this.render();
      }
    } catch (error) {
      this.showMetadataError("assignees", error);
    }
  }

  private async pickReviewers(): Promise<void> {
    if (!this.draft) return;
    try {
      const users = await this.metadataApi.listReviewerCandidates(this.draft.repoInfo);
      const selected = await vscode.window.showQuickPick(
        users.map((user) => ({
          label: user.login,
          description: user.full_name || undefined,
          picked: this.draft?.reviewers.some((item) => item.login === user.login),
          user,
        })),
        { canPickMany: true, placeHolder: "Select requested reviewers" },
      );
      if (selected) {
        this.draft.reviewers = selected.map((item) => item.user);
        this.render();
      }
    } catch (error) {
      this.showMetadataError("reviewers", error);
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
        { canPickMany: true, placeHolder: "Select pull request labels" },
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
      const clearItem = { label: "$(circle-slash) No milestone", milestone: undefined as GiteaMilestone | undefined };
      const selected = await vscode.window.showQuickPick(
        [
          clearItem,
          ...milestones.map((milestone) => ({
            label: milestone.title,
            milestone,
          })),
        ],
        { placeHolder: "Select a milestone" },
      );
      if (selected) {
        this.draft.milestone = selected.milestone;
        this.render();
      }
    } catch (error) {
      this.showMetadataError("milestones", error);
    }
  }

  private async create(asDraft: boolean): Promise<void> {
    if (!this.draft) return;
    const title = this.draft.title.trim();
    if (!title) {
      vscode.window.showWarningMessage("A pull request title is required.");
      return;
    }
    if (!validBranchPair(this.draft.baseBranch, this.draft.headBranch)) {
      vscode.window.showWarningMessage("Base and head branches must be different.");
      return;
    }

    const repoInfo = this.draft.repoInfo;
    const reviewers = this.draft.reviewers.map((user) => user.login);
    const createParams = {
      title: asDraft ? draftTitle(title) : title,
      body: this.draft.body,
      head: this.draft.headBranch,
      base: this.draft.baseBranch,
      assignees: this.draft.assignees.map((user) => user.login),
      labels: this.draft.labels.map((label) => label.id),
      milestone: this.draft.milestone?.id,
    };

    try {
      const pullRequest = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `${asDraft ? "Creating draft" : "Creating"} pull request in ${repoInfo.label}...`,
        },
        () => this.api.createPullRequest(repoInfo, createParams),
      );

      if (reviewers.length > 0) {
        try {
          await this.metadataApi.requestReviewers(repoInfo, pullRequest.number, reviewers);
        } catch (error) {
          vscode.window.showWarningMessage(
            `PR #${pullRequest.number} was created, but reviewers could not be requested: ${(error as Error).message}`,
          );
        }
      }

      this.draft = undefined;
      this.prProvider.refresh();
      await this.session.activate(this.repositoryRef(repoInfo), pullRequest);
      vscode.window.showInformationMessage(
        `${asDraft ? "Draft PR" : "PR"} #${pullRequest.number} created.`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create pull request: ${(error as Error).message}`,
      );
    }
  }

  private showMetadataError(kind: string, error: unknown): void {
    vscode.window.showErrorMessage(
      `Unable to load pull request ${kind}: ${(error as Error).message}`,
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
    if (!this.view) {
      return;
    }

    if (!this.draft || this.session.current.kind !== "creating") {
      this.view.webview.html = this.emptyHtml();
      return;
    }

    const {
      repoInfo,
      branches,
      baseBranch,
      headBranch,
      title,
      body,
      assignees,
      reviewers,
      labels,
      milestone,
    } = this.draft;
    const branchOptions = (selected: string) =>
      branches
        .map(
          (branch) =>
            `<option value="${escapeHtml(branch)}"${branch === selected ? " selected" : ""}>${escapeHtml(branch)}</option>`,
        )
        .join("");

    const summary = (values: string[], empty: string) =>
      escapeHtml(values.length > 0 ? values.join(", ") : empty);

    this.view.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .repo { margin-bottom: 14px; color: var(--vscode-descriptionForeground); }
  label { display: block; margin: 10px 0 4px; font-weight: 600; }
  select, input, textarea { box-sizing: border-box; width: 100%; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; }
  textarea { min-height: 110px; resize: vertical; }
  .branches { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .metadata { margin-top: 14px; border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
  .metadata button { display: block; width: 100%; text-align: left; margin: 4px 0; }
  .actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
  button { border: 0; padding: 6px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.link { color: var(--vscode-textLink-foreground); background: transparent; padding-left: 0; }
  .hint { margin-top: 10px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="repo">${escapeHtml(repoInfo.label)} · ${escapeHtml(repoInfo.serverUrl)}</div>
  <div class="branches">
    <div><label for="base">BASE</label><select id="base">${branchOptions(baseBranch)}</select></div>
    <div><label for="head">MERGE</label><select id="head">${branchOptions(headBranch)}</select></div>
  </div>
  <label for="title">TITLE</label>
  <input id="title" value="${escapeHtml(title)}" placeholder="Pull request title">
  <label for="body">DESCRIPTION</label>
  <textarea id="body" placeholder="Describe the changes">${escapeHtml(body)}</textarea>

  <div class="metadata">
    <button class="secondary" data-action="pickReviewers">Reviewers · ${summary(reviewers.map((user) => user.login), "None")}</button>
    <button class="secondary" data-action="pickAssignees">Assignees · ${summary(assignees.map((user) => user.login), "None")}</button>
    <button class="secondary" data-action="pickLabels">Labels · ${summary(labels.map((label) => label.name), "None")}</button>
    <button class="secondary" data-action="pickMilestone">Milestone · ${escapeHtml(milestone?.title ?? "None")}</button>
  </div>

  <div class="hint">Create Draft uses Gitea's work-in-progress convention by applying the configured-compatible <strong>WIP:</strong> title prefix.</div>
  <div class="actions">
    <button class="secondary" id="cancel">Cancel</button>
    <button id="create">Create</button>
    <button id="createDraft">Create Draft</button>
  </div>
  <button class="link" id="legacy">Use legacy create flow</button>
<script>
  const vscode = acquireVsCodeApi();
  const base = document.getElementById('base');
  const head = document.getElementById('head');
  const title = document.getElementById('title');
  const body = document.getElementById('body');
  function snapshot(type, extra = {}) {
    return { type, baseBranch: base.value, headBranch: head.value, title: title.value, body: body.value, ...extra };
  }
  function branchesChanged() { vscode.postMessage(snapshot('changeBranches')); }
  base.addEventListener('change', branchesChanged);
  head.addEventListener('change', branchesChanged);
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => vscode.postMessage(snapshot(button.dataset.action))));
  document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  document.getElementById('legacy').addEventListener('click', () => vscode.postMessage({ type: 'openLegacy' }));
  document.getElementById('create').addEventListener('click', () => vscode.postMessage(snapshot('create', { draft: false })));
  document.getElementById('createDraft').addEventListener('click', () => vscode.postMessage(snapshot('create', { draft: true })));
</script>
</body>
</html>`;
  }

  private emptyHtml(): string {
    return `<!doctype html><html><body style="padding:12px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-font-family)">Use <strong>Gitea: Create Pull Request</strong> to start a sidebar creation session.</body></html>`;
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
