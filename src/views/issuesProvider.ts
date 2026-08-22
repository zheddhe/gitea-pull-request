import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { AuthManager } from "../auth/authManager";
import { RepoManager, RepoInfo } from "../context/repoManager";
import type { GiteaIssue } from "../api/types";

export type IssueFilter = "open" | "closed";

interface RepoIssueState {
  issues: GiteaIssue[];
  page: number;
  hasMore: boolean;
  loading: boolean;
}

export function isIssueAssignedTo(issue: GiteaIssue, username: string): boolean {
  return (
    issue.assignee?.login === username ||
    issue.assignees?.some((assignee) => assignee.login === username) === true
  );
}

export class IssueScopeItem extends vscode.TreeItem {
  constructor(filter: IssueFilter) {
    super(
      filter === "open" ? "Showing open issues" : "Showing closed issues",
      vscode.TreeItemCollapsibleState.None,
    );
    this.id = "issue-scope";
    this.contextValue = "issueScope";
    this.description = "Change filter";
    this.iconPath = new vscode.ThemeIcon("filter");
    this.command = { command: "gitea.configureIssueFilter", title: "Filter Issues" };
    this.tooltip = "Choose whether the Issues view shows open or closed issues.";
  }
}

export class RepoGroupItem extends vscode.TreeItem {
  constructor(public readonly repoInfo: RepoInfo, authed: boolean) {
    super(`${repoInfo.owner}/${repoInfo.repo}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `issue-repo:${repoInfo.key}`;
    this.contextValue = "repoGroup";
    this.description = repoInfo.currentBranch ? `(${repoInfo.currentBranch})` : "";
    this.iconPath = new vscode.ThemeIcon(authed ? "repo" : "repo-forked");
    this.tooltip = `${repoInfo.serverUrl}/${repoInfo.owner}/${repoInfo.repo}`;
  }
}

export class AssignedIssuesItem extends vscode.TreeItem {
  constructor(
    public readonly issues: GiteaIssue[],
    public readonly repoInfo: RepoInfo,
  ) {
    super(
      `Assigned to Me (${issues.length})`,
      issues.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `issue-assigned:${repoInfo.key}`;
    this.contextValue = "issueAssignedToMe";
    this.iconPath = new vscode.ThemeIcon("person");
    this.tooltip = "Issues in the current Open/Closed filter assigned to you.";
  }
}

export class IssueItem extends vscode.TreeItem {
  constructor(public readonly issue: GiteaIssue, public readonly repoInfo: RepoInfo) {
    super(`#${issue.number} ${issue.title}`, vscode.TreeItemCollapsibleState.None);
    this.id = `issue:${repoInfo.key}:${issue.number}`;
    this.contextValue = `issue_${issue.state}`;

    const tooltipLines = [
      `**#${issue.number}** ${issue.title}`,
      "",
      `By **${issue.user.login}** · ${issue.state} · ${issue.comments} comment(s)`,
    ];
    if (issue.assignees?.length) {
      tooltipLines.push("", `Assignees: ${issue.assignees.map((a) => a.login).join(", ")}`);
    }
    if (issue.labels?.length) {
      tooltipLines.push(`Labels: ${issue.labels.map((l) => l.name).join(", ")}`);
    }
    if (issue.milestone) {
      tooltipLines.push(`Milestone: ${issue.milestone.title}`);
    }
    if (issue.body?.trim()) {
      tooltipLines.push("", "---", "", issue.body.trim());
    }
    const tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));
    tooltip.isTrusted = false;
    tooltip.supportHtml = false;
    this.tooltip = tooltip;

    this.iconPath =
      issue.state === "open"
        ? new vscode.ThemeIcon("issues", new vscode.ThemeColor("charts.green"))
        : new vscode.ThemeIcon("issue-closed", new vscode.ThemeColor("charts.red"));
    this.description = `${issue.user.login} · ${relativeTime(issue.updated_at)}`;
  }
}

export class LoadMoreIssueItem extends vscode.TreeItem {
  constructor(public readonly repoKey: string, filter: IssueFilter) {
    super("Load more...", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "loadMore";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.command = {
      command: "gitea.loadMoreIssues",
      title: "Load more issues",
      arguments: [repoKey, filter],
    };
  }
}

export class IssuesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private filter: IssueFilter = "open";
  private stateMap = new Map<string, RepoIssueState>();

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly auth: AuthManager,
  ) {
    repoManager.onDidChange(() => this.refresh());
    auth.onDidChangeSession(() => this.refresh());
  }

  getFilter(): IssueFilter { return this.filter; }
  setFilter(filter: IssueFilter): void {
    if (this.filter === filter) return;
    this.filter = filter;
    this.refresh();
  }
  refresh(): void {
    this.stateMap.clear();
    this._onDidChangeTreeData.fire();
  }

  async loadMore(repoKey: string): Promise<void> {
    const state = this.stateMap.get(repoKey);
    if (!state || state.loading || !state.hasMore) return;
    state.page += 1;
    const repoInfo = this.repoManager.getRepos().find((r) => r.key === repoKey);
    if (repoInfo) await this.fetchForRepo(repoInfo, state);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const repos = this.repoManager.getRepos();
      if (repos.length === 0) {
        const item = new vscode.TreeItem("No Gitea repositories detected", vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        return [item];
      }
      const items: vscode.TreeItem[] = [new IssueScopeItem(this.filter)];
      for (const r of repos) {
        const session = await this.auth.getSession(r.serverUrl);
        items.push(new RepoGroupItem(r, !!session));
      }
      return items;
    }
    if (element instanceof RepoGroupItem) {
      const { repoInfo } = element;
      const session = await this.auth.getSession(repoInfo.serverUrl);
      if (!session) {
        const signIn = new vscode.TreeItem("Sign in to load issues", vscode.TreeItemCollapsibleState.None);
        signIn.iconPath = new vscode.ThemeIcon("account");
        signIn.command = { command: "gitea.signIn", title: "Sign In" };
        return [signIn];
      }
      return this.getRepoChildren(repoInfo, session.username);
    }
    if (element instanceof AssignedIssuesItem) {
      return element.issues.map((issue) => new IssueItem(issue, element.repoInfo));
    }
    return [];
  }

  private async getRepoChildren(
    repoInfo: RepoInfo,
    username: string,
  ): Promise<vscode.TreeItem[]> {
    let state = this.stateMap.get(repoInfo.key);
    if (!state) {
      state = { issues: [], page: 1, hasMore: false, loading: false };
      this.stateMap.set(repoInfo.key, state);
      await this.fetchForRepo(repoInfo, state);
      return [];
    }
    if (state.loading) {
      const item = new vscode.TreeItem("Loading...", vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("loading~spin");
      return [item];
    }

    const assignedIssues = state.issues.filter((issue) =>
      isIssueAssignedTo(issue, username),
    );
    const assigned = new AssignedIssuesItem(assignedIssues, repoInfo);

    if (state.issues.length === 0) {
      const empty = new vscode.TreeItem(`No ${this.filter} issues`, vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon("info");
      return [assigned, empty];
    }

    const items: vscode.TreeItem[] = [
      assigned,
      ...state.issues.map((issue) => new IssueItem(issue, repoInfo)),
    ];
    if (state.hasMore) items.push(new LoadMoreIssueItem(repoInfo.key, this.filter));
    return items;
  }

  private async fetchForRepo(repoInfo: RepoInfo, state: RepoIssueState): Promise<void> {
    if (state.loading) return;
    state.loading = true;
    this._onDidChangeTreeData.fire();
    try {
      const config = vscode.workspace.getConfiguration("gitea");
      const limit = config.get<number>("itemsPerPage") ?? 20;
      const result = await this.api.listIssues(repoInfo, this.filter, state.page, limit);
      state.issues = state.page === 1 ? result.items : [...state.issues, ...result.items];
      state.hasMore = result.hasMore;
    } catch (err) {
      vscode.window.showErrorMessage(`[${repoInfo.label}] Failed to load issues: ${(err as Error).message}`);
      state.issues = [];
      state.hasMore = false;
    } finally {
      state.loading = false;
      this._onDidChangeTreeData.fire();
    }
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
