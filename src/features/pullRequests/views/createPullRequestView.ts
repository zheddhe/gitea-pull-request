import * as vscode from "vscode";
import { GiteaApiClient } from "../../../api/giteaApiClient";
import { RepoInfo, RepoManager } from "../../../context/repoManager";
import { PullRequestProvider } from "../../../views/pullRequestProvider";
import { PullRequestSessionService } from "../services/pullRequestSessionService";

interface CreateDraft {
  repoInfo: RepoInfo;
  branches: string[];
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}

type CreateViewMessage =
  | { type: "changeBranches"; baseBranch: string; headBranch: string }
  | { type: "create"; baseBranch: string; headBranch: string; title: string; body: string }
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
      title: "",
      body: "",
    };

    await this.session.startCreating(
      {
        key: repoInfo.key,
        owner: repoInfo.owner,
        name: repoInfo.repo,
        fullName: repoInfo.label,
      },
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

    if (message.type === "changeBranches") {
      if (
        !this.draft.branches.includes(message.baseBranch) ||
        !this.draft.branches.includes(message.headBranch) ||
        message.baseBranch === message.headBranch
      ) {
        return;
      }
      this.draft.baseBranch = message.baseBranch;
      this.draft.headBranch = message.headBranch;
      await this.session.startCreating(
        {
          key: this.draft.repoInfo.key,
          owner: this.draft.repoInfo.owner,
          name: this.draft.repoInfo.repo,
          fullName: this.draft.repoInfo.label,
        },
        message.baseBranch,
        message.headBranch,
      );
      return;
    }

    const title = message.title.trim();
    if (!title) {
      vscode.window.showWarningMessage("A pull request title is required.");
      return;
    }
    if (message.baseBranch === message.headBranch) {
      vscode.window.showWarningMessage("Base and head branches must be different.");
      return;
    }

    const repoInfo = this.draft.repoInfo;
    try {
      const pullRequest = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating pull request in ${repoInfo.label}...`,
        },
        () =>
          this.api.createPullRequest(repoInfo, {
            title,
            body: message.body,
            head: message.headBranch,
            base: message.baseBranch,
          }),
      );

      this.draft = undefined;
      this.prProvider.refresh();
      await this.session.activate(
        {
          key: repoInfo.key,
          owner: repoInfo.owner,
          name: repoInfo.repo,
          fullName: repoInfo.label,
        },
        pullRequest,
      );
      vscode.window.showInformationMessage(`PR #${pullRequest.number} created.`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create pull request: ${(error as Error).message}`,
      );
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    if (!this.draft || this.session.current.kind !== "creating") {
      this.view.webview.html = this.emptyHtml();
      return;
    }

    const { repoInfo, branches, baseBranch, headBranch, title, body } = this.draft;
    const branchOptions = (selected: string) =>
      branches
        .map(
          (branch) =>
            `<option value="${escapeHtml(branch)}"${branch === selected ? " selected" : ""}>${escapeHtml(branch)}</option>`,
        )
        .join("");

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
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { border: 0; padding: 6px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.link { color: var(--vscode-textLink-foreground); background: transparent; padding-left: 0; }
  .hint { margin-top: 14px; color: var(--vscode-descriptionForeground); }
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
  <div class="hint">Metadata and Files Changed are added in the next Phase 2 increments.</div>
  <div class="actions">
    <button class="secondary" id="cancel">Cancel</button>
    <button id="create">Create</button>
  </div>
  <button class="link" id="legacy">Use legacy create flow</button>
<script>
  const vscode = acquireVsCodeApi();
  const base = document.getElementById('base');
  const head = document.getElementById('head');
  function branchesChanged() {
    vscode.postMessage({ type: 'changeBranches', baseBranch: base.value, headBranch: head.value });
  }
  base.addEventListener('change', branchesChanged);
  head.addEventListener('change', branchesChanged);
  document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  document.getElementById('legacy').addEventListener('click', () => vscode.postMessage({ type: 'openLegacy' }));
  document.getElementById('create').addEventListener('click', () => vscode.postMessage({
    type: 'create',
    baseBranch: base.value,
    headBranch: head.value,
    title: document.getElementById('title').value,
    body: document.getElementById('body').value
  }));
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
