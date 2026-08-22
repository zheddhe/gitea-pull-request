import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { AuthManager } from "../auth/authManager";
import { RepoManager, RepoInfo } from "../context/repoManager";
import type { GiteaWorkflowRun, GiteaWorkflowJob } from "../api/types";

interface RepoCIState {
  runs: GiteaWorkflowRun[];
  page: number;
  hasMore: boolean;
  loading: boolean;
}

// ── Status and metadata helpers ───────────────────────────────────────────────

export function iconForStatus(status: string): vscode.ThemeIcon {
  switch (status) {
    case "success":
    case "completed":
      return new vscode.ThemeIcon(
        "pass",
        new vscode.ThemeColor("charts.green"),
      );
    case "failure":
    case "failed":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    case "running":
    case "in_progress":
      return new vscode.ThemeIcon("loading~spin");
    case "waiting":
    case "pending":
      return new vscode.ThemeIcon(
        "watch",
        new vscode.ThemeColor("charts.yellow"),
      );
    case "cancelled":
      return new vscode.ThemeIcon(
        "circle-slash",
        new vscode.ThemeColor("disabledForeground"),
      );
    case "skipped":
      return new vscode.ThemeIcon(
        "debug-step-over",
        new vscode.ThemeColor("disabledForeground"),
      );
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

function cleanMetadata(value: string | undefined | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function isActiveRunStatus(status: string): boolean {
  return ["running", "waiting", "pending", "in_progress"].includes(status);
}

export function displayStatusForRun(run: GiteaWorkflowRun): string {
  const status = cleanMetadata(run.status) ?? "unknown";
  if (status === "completed") {
    return cleanMetadata(run.conclusion) ?? status;
  }
  return status;
}

export function formatRunDateTime(run: GiteaWorkflowRun): string | undefined {
  const raw = cleanMetadata(run.run_started_at) ?? cleanMetadata(run.created_at);
  if (!raw) {
    return undefined;
  }

  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    return undefined;
  }

  return value.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function runSecondaryMetadata(run: GiteaWorkflowRun): string[] {
  return [cleanMetadata(run.event), formatRunDateTime(run)].filter(
    (value): value is string => !!value,
  );
}

// ── Tree items ────────────────────────────────────────────────────────────────

export class RepoGroupItem extends vscode.TreeItem {
  constructor(
    public readonly repoInfo: RepoInfo,
    authed: boolean,
  ) {
    super(
      `${repoInfo.owner}/${repoInfo.repo}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `repo:${repoInfo.key}`;
    this.contextValue = "repoGroup";
    this.description = repoInfo.currentBranch
      ? `(${repoInfo.currentBranch})`
      : "";
    this.iconPath = new vscode.ThemeIcon(authed ? "repo" : "repo-forked");
    this.tooltip = `${repoInfo.serverUrl}/${repoInfo.owner}/${repoInfo.repo}`;
  }
}

export class CIRunItem extends vscode.TreeItem {
  constructor(
    public readonly run: GiteaWorkflowRun,
    public readonly repoInfo: RepoInfo,
  ) {
    super(
      run.display_title || run.name || `Run #${run.run_number}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `run:${repoInfo.key}:${run.id}`;
    this.contextValue = "ciRun";

    const status = displayStatusForRun(run);
    const isRunning = isActiveRunStatus(run.status);
    const secondaryMetadata = runSecondaryMetadata(run);
    this.description = [isRunning ? `🔴 ${status}` : status, ...secondaryMetadata].join(
      " · ",
    );

    const tooltipLines = [
      `**${run.display_title || run.name || `Run #${run.run_number}`}**`,
      "",
      `Status: \`${status}\``,
    ];
    const event = cleanMetadata(run.event);
    if (event) {
      tooltipLines.push(`Event: \`${event}\``);
    }
    const dateTime = formatRunDateTime(run);
    if (dateTime) {
      tooltipLines.push(`Date: ${dateTime}`);
    }
    const branch = cleanMetadata(run.head_branch);
    const commitMessage = cleanMetadata(run.head_commit?.message);
    if (branch) {
      tooltipLines.push("", `Branch: \`${branch}\``);
    }
    if (commitMessage) {
      tooltipLines.push(`Commit: ${commitMessage}`);
    }
    if (isRunning) {
      tooltipLines.push("", "🔴 **Live**");
    }
    this.tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));
    this.iconPath = iconForStatus(status);
  }
}

export class CIJobItem extends vscode.TreeItem {
  constructor(
    public readonly job: GiteaWorkflowJob,
    public readonly runId: number,
    public readonly repoInfo: RepoInfo,
  ) {
    const isRunning =
      job.status === "running" ||
      job.status === "waiting" ||
      job.status === "in_progress";

    // Jobs are not expandable since Gitea API doesn't provide step details
    super(job.name, vscode.TreeItemCollapsibleState.None);
    this.id = `job:${repoInfo.key}:${runId}:${job.id}`;
    this.contextValue = "ciJob";
    const status = job.conclusion || job.status;

    this.description = isRunning ? `🔴 ${status}` : status;
    this.iconPath = iconForStatus(status);
    this.tooltip = `${job.name} — ${status}${isRunning ? " (Live)" : ""}\n\nNote: Gitea API does not expose step-level details.\nView logs for detailed execution information.`;
  }
}

export class CIStepItem extends vscode.TreeItem {
  constructor(stepName: string, status: string, number: number) {
    super(`${number}. ${stepName}`, vscode.TreeItemCollapsibleState.None);
    const isRunning = status === "running" || status === "in_progress";
    const isCompleted = status === "success" || status === "completed";

    // Highlight currently executing step
    if (isRunning) {
      this.description = `⚡ EXECUTING`;
      this.tooltip = `Currently running: ${stepName}`;
    } else if (isCompleted) {
      this.description = "✓ completed";
    } else {
      this.description = status;
    }

    this.iconPath = iconForStatus(status);
  }
}

export class CILoadMoreItem extends vscode.TreeItem {
  constructor(public readonly repoKey: string) {
    super("Load more...", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "loadMore";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.command = {
      command: "gitea.loadMoreCI",
      title: "Load more runs",
      arguments: [repoKey],
    };
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class CIRunsProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private stateMap = new Map<string, RepoCIState>();
  private jobCache = new Map<number, GiteaWorkflowJob[]>();

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly auth: AuthManager,
  ) {
    repoManager.onDidChange(() => this.refresh());
    auth.onDidChangeSession(() => this.refresh());
    // Auto-polling disabled - use manual refresh instead
  }

  refresh(): void {
    this.stateMap.clear();
    this.jobCache.clear();
    this._onDidChangeTreeData.fire();
  }

  async refreshRepo(repoKey: string): Promise<void> {
    const state = this.stateMap.get(repoKey);
    if (state) {
      // Don't show loading indicator during refresh
      const wasLoading = state.loading;
      state.loading = false;
      state.page = 1;
      const repoInfo = this.repoManager.getRepos().find((r) => r.key === repoKey);
      if (repoInfo) {
        await this.fetchForRepo(repoInfo, state, true);
      }
      state.loading = wasLoading;
    }
  }

  async refreshJob(jobId: number, runId: number, repoInfo: RepoInfo): Promise<void> {
    try {
      const job = await this.api.getWorkflowJob(repoInfo, jobId);
      // Update job in cache
      const jobs = this.jobCache.get(runId);
      if (jobs) {
        const index = jobs.findIndex((j) => j.id === jobId);
        if (index !== -1) {
          jobs[index] = job;
          // Only fire update for this specific job's parent run
          this._onDidChangeTreeData.fire();
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to refresh job: ${(err as Error).message}`,
      );
    }
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
          "Sign in to load CI runs",
          vscode.TreeItemCollapsibleState.None,
        );
        signIn.iconPath = new vscode.ThemeIcon("account");
        signIn.command = { command: "gitea.signIn", title: "Sign In" };
        return [signIn];
      }
      return this.getRepoChildren(repoInfo);
    }

    if (element instanceof CIRunItem) {
      return this.getJobsForRun(element.run.id, element.repoInfo);
    }

    // Jobs are not expandable - Gitea API doesn't support step-level details

    return [];
  }

  private async getRepoChildren(
    repoInfo: RepoInfo,
  ): Promise<vscode.TreeItem[]> {
    let state = this.stateMap.get(repoInfo.key);
    if (!state) {
      state = { runs: [], page: 1, hasMore: false, loading: false };
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
    if (state.runs.length === 0) {
      const empty = new vscode.TreeItem(
        "No CI runs found",
        vscode.TreeItemCollapsibleState.None,
      );
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }
    const items: vscode.TreeItem[] = state.runs.map(
      (r) => new CIRunItem(r, repoInfo),
    );
    if (state.hasMore) {
      items.push(new CILoadMoreItem(repoInfo.key));
    }
    return items;
  }

  private async fetchForRepo(
    repoInfo: RepoInfo,
    state: RepoCIState,
    silentRefresh: boolean = false,
  ): Promise<void> {
    if (state.loading && !silentRefresh) {
      return;
    }
    const shouldShowLoading = !silentRefresh;
    if (shouldShowLoading) {
      state.loading = true;
      this._onDidChangeTreeData.fire();
    }
    try {
      const config = vscode.workspace.getConfiguration("gitea");
      const limit: number = config.get<number>("itemsPerPage") ?? 20;
      const result = await this.api.listWorkflowRuns(
        repoInfo,
        undefined,
        state.page,
        limit,
      );
      state.runs =
        state.page === 1 ? result.items : [...state.runs, ...result.items];
      state.hasMore = result.hasMore;
    } catch (err) {
      vscode.window.showErrorMessage(
        `[${repoInfo.label}] Failed to load CI runs: ${(err as Error).message}`,
      );
      state.runs = [];
      state.hasMore = false;
    } finally {
      if (shouldShowLoading) {
        state.loading = false;
      }
      this._onDidChangeTreeData.fire();
    }
  }

  private async getJobsForRun(
    runId: number,
    repoInfo: RepoInfo,
  ): Promise<vscode.TreeItem[]> {
    if (this.jobCache.has(runId)) {
      return (this.jobCache.get(runId) ?? []).map(
        (j) => new CIJobItem(j, runId, repoInfo),
      );
    }
    try {
      const jobs = await this.api.listWorkflowJobs(repoInfo, runId);
      this.jobCache.set(runId, jobs);
      return jobs.map((j) => new CIJobItem(j, runId, repoInfo));
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to load jobs: ${(err as Error).message}`,
      );
      return [];
    }
  }

  dispose(): void {
    // Cleanup if needed
  }
}
