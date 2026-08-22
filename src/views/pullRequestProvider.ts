import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { AuthManager } from "../auth/authManager";
import { RepoManager, RepoInfo } from "../context/repoManager";
import type { GiteaPullRequest, GiteaReview } from "../api/types";

export type PRFilter = "open" | "closed";
type PRCategory = "all" | "waiting" | "created";

interface RepoPRState {
  prs: GiteaPullRequest[];
  page: number;
  hasMore: boolean;
  loading: boolean;
}

export class RepoGroupItem extends vscode.TreeItem {
  constructor(
    public readonly repoInfo: RepoInfo,
    authed: boolean,
  ) {
    super(
      `${repoInfo.owner}/${repoInfo.repo}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `pr-repo:${repoInfo.key}`;
    this.contextValue = "repoGroup";
    this.description = repoInfo.currentBranch
      ? `(${repoInfo.currentBranch})`
      : "";
    this.iconPath = new vscode.ThemeIcon(authed ? "repo" : "repo-forked");
    this.tooltip = `${repoInfo.serverUrl}/${repoInfo.owner}/${repoInfo.repo}`;
  }
}

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly category: PRCategory,
    public readonly prs: GiteaPullRequest[],
    public readonly repoInfo: RepoInfo,
  ) {
    const label =
      category === "all" ? "All Open"
      : category === "waiting" ? "Waiting for my review"
      : "Created by me";
    const icon = category === "created" ? "person" : "git-pull-request";
    super(
      `${label} (${prs.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id =
      category === "waiting"
        ? `pr-cat:${repoInfo.key}:waiting-icon-probe`
        : `pr-cat:${repoInfo.key}:${category}`;
    this.contextValue = `category-${category}`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class PullRequestItem extends vscode.TreeItem {
  constructor(
    public readonly pr: GiteaPullRequest,
    public readonly repoInfo: RepoInfo,
    reviewState?: string,
  ) {
    super(
      `#${pr.number} ${pr.title}`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.id = `pr:${repoInfo.key}:${pr.number}`;
    this.contextValue = "pullRequest";

    const tooltipLines = [
      `**#${pr.number}** ${pr.title}`,
      "",
      `By **${pr.user.login}** · ${pr.state} · ${pr.comments} comment(s) · ${pr.review_comments} review comment(s)`,
      "",
      `\`${pr.head.ref}\` → \`${pr.base.ref}\``,
    ];
    if (pr.assignees?.length) {
      tooltipLines.push("", `Assignees: ${pr.assignees.map((a) => a.login).join(", ")}`);
    }
    if (pr.labels?.length) {
      tooltipLines.push(`Labels: ${pr.labels.map((l) => l.name).join(", ")}`);
    }
    const hasDiffStats =
      typeof pr.additions === "number" &&
      typeof pr.deletions === "number" &&
      typeof pr.changed_files === "number";
    if (hasDiffStats) {
      tooltipLines.push(
        `Changes: +${pr.additions} / -${pr.deletions} · ${pr.changed_files} file(s)`,
      );
    }
    if (pr.body?.trim()) {
      tooltipLines.push("", "---", "", pr.body.trim());
    }
    const tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));
    tooltip.isTrusted = false;
    tooltip.supportHtml = false;
    this.tooltip = tooltip;

    this.iconPath = this.getIcon(pr, reviewState);
    this.description = `${pr.user.login} · ${relativeTime(pr.updated_at)}`;
  }

  private getIcon(pr: GiteaPullRequest, reviewState?: string): vscode.ThemeIcon {
    if (pr.merged) {
      return new vscode.ThemeIcon(
        "git-merge",
        new vscode.ThemeColor("charts.green"),
      );
    }
    if (pr.state === "closed") {
      return new vscode.ThemeIcon(
        "git-pull-request-closed",
        new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
      );
    }
    const color =
      reviewState === "APPROVED" ? "charts.green"
      : reviewState === "REQUEST_CHANGES" ? "charts.red"
      : "charts.yellow";
    return new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor(color));
  }
}

export class LoadMorePRItem extends vscode.TreeItem {
  constructor(
    public readonly repoKey: string,
    filter: PRFilter,
  ) {
    super("Load more...", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "loadMore";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.command = {
      command: "gitea.loadMorePRs",
      title: "Load more pull requests",
      arguments: [repoKey, filter],
    };
  }
}

export class PullRequestProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private filter: PRFilter = "open";
  private stateMap = new Map<string, RepoPRState>();
  private reviewStateCache = new Map<string, string | undefined>();

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly auth: AuthManager,
  ) {
    repoManager.onDidChange(() => this.refresh());
    auth.onDidChangeSession(() => this.refresh());
  }

  setFilter(filter: PRFilter): void {
    this.filter = filter;
    this.refresh();
  }

  refresh(): void {
    this.stateMap.clear();
    this.reviewStateCache.clear();
    this._onDidChangeTreeData.fire();
  }

  async loadMore(repoKey: string): Promise<void> {
    const state = this.stateMap.get(repoKey);
    if (!state || state.loading || !state.hasMore) {
      return;
    }
    state.page += 1;
    const repoInfo = this.repoManager.getRepos().find((r) => r.key === repoKey);
    if (repoInfo) {
      await this.fetchForRepo(repoInfo, state);
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const repos = this.repoManager.getRepos();
      if (repos.length === 0) {
        const item = new vscode.TreeItem(
          "No Gitea repositories detected",
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon("info");
        item.command = { command: "gitea.signIn", title: "Sign In" };
        return [item];
      }
      const items: vscode.TreeItem[] = [];
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
        const signIn = new vscode.TreeItem(
          "Sign in to load pull requests",
          vscode.TreeItemCollapsibleState.None,
        );
        signIn.iconPath = new vscode.ThemeIcon("account");
        signIn.command = { command: "gitea.signIn", title: "Sign In" };
        return [signIn];
      }
      return this.getRepoCategories(repoInfo, session.username);
    }

    if (element instanceof CategoryItem) {
      return element.prs.map((pr) => {
        const reviewState = this.reviewStateCache.get(
          `${element.repoInfo.key}:${pr.number}`,
        );
        return new PullRequestItem(pr, element.repoInfo, reviewState);
      });
    }

    return [];
  }

  private async getRepoCategories(
    repoInfo: RepoInfo,
    username: string,
  ): Promise<vscode.TreeItem[]> {
    let state = this.stateMap.get(repoInfo.key);
    if (!state) {
      state = { prs: [], page: 1, hasMore: false, loading: false };
      this.stateMap.set(repoInfo.key, state);
      await this.fetchForRepo(repoInfo, state);
      return [];
    }
    if (state.loading) {
      const item = new vscode.TreeItem(
        "Loading...",
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("loading~spin");
      return [item];
    }
    if (state.prs.length === 0) {
      const empty = new vscode.TreeItem(
        `No ${this.filter} pull requests`,
        vscode.TreeItemCollapsibleState.None,
      );
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }

    const allPrs = state.prs;
    const waitingPrs = allPrs.filter((pr) => {
      const isAssigned =
        pr.assignee?.login === username ||
        pr.assignees?.some((a) => a.login === username);
      return isAssigned;
    });
    const createdPrs = allPrs.filter((pr) => pr.user.login === username);

    const categories: vscode.TreeItem[] = [];
    if (allPrs.length > 0) {
      categories.push(new CategoryItem("all", allPrs, repoInfo));
    }
    if (waitingPrs.length > 0) {
      categories.push(new CategoryItem("waiting", waitingPrs, repoInfo));
    }
    if (createdPrs.length > 0) {
      categories.push(new CategoryItem("created", createdPrs, repoInfo));
    }

    return categories;
  }

  private async fetchForRepo(
    repoInfo: RepoInfo,
    state: RepoPRState,
  ): Promise<void> {
    if (state.loading) {
      return;
    }
    state.loading = true;
    this._onDidChangeTreeData.fire();
    try {
      const config = vscode.workspace.getConfiguration("gitea");
      const limit: number = config.get<number>("itemsPerPage") ?? 20;
      const result = await this.api.listPullRequests(
        repoInfo,
        this.filter,
        state.page,
        limit,
      );
      state.prs =
        state.page === 1 ? result.items : [...state.prs, ...result.items];
      state.hasMore = result.hasMore;
      await this.cacheReviewStates(repoInfo, state.prs);
    } catch (err) {
      vscode.window.showErrorMessage(
        `[${repoInfo.label}] Failed to load PRs: ${(err as Error).message}`,
      );
      state.prs = [];
      state.hasMore = false;
    } finally {
      state.loading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  private async cacheReviewStates(
    repoInfo: RepoInfo,
    prs: GiteaPullRequest[],
  ): Promise<void> {
    const promises = prs.map(async (pr) => {
      const reviews = await this.api
        .listReviews(repoInfo, pr.number)
        .catch(() => [] as GiteaReview[]);
      const nonStale = reviews
        .filter((r) => !r.stale)
        .sort(
          (a, b) =>
            new Date(a.submitted_at).getTime() -
            new Date(b.submitted_at).getTime(),
        );
      const latest =
        nonStale.length > 0 ? nonStale[nonStale.length - 1].state : undefined;
      this.reviewStateCache.set(`${repoInfo.key}:${pr.number}`, latest);
    });
    await Promise.all(promises);
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  return `${Math.floor(hrs / 24)}d ago`;
}
