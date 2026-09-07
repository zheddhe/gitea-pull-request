import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { AuthManager } from "../auth/authManager";
import { RepoManager, RepoInfo } from "../context/repoManager";
import type {
  GiteaWorkflowRun,
  GiteaWorkflowJob,
} from "../api/types";
import { warn } from "../debug/outputChannel";
import {
  ciStatusLabel,
  isCIActiveState,
  jobPresentation,
  normalizeCIState,
  runPresentation,
  type CISemanticState,
} from "../features/ci/domain/ciPresentation";
import type {
  CIArtifactDetail,
  CIStepDetail,
} from "../features/ci/domain/ciExecutionDetail";
import { normalizeStepDetails } from "../features/ci/domain/ciExecutionDetail";
import { CIExecutionDetailService } from "../features/ci/services/ciExecutionDetailService";
import { CIArtifactDetailService } from "../features/ci/services/ciArtifactDetailService";
import { GiteaActionsDetailApi } from "../features/ci/services/giteaActionsDetailApi";

interface RepoCIState {
  runs: GiteaWorkflowRun[];
  page: number;
  hasMore: boolean;
  loading: boolean;
}

export interface CIPollResult {
  changed: boolean;
  hasActiveRuns: boolean;
}

export function iconForStatus(
  status: string,
  conclusion?: string,
): vscode.ThemeIcon {
  return iconForSemanticState(normalizeCIState(status, conclusion));
}

function iconForSemanticState(state: CISemanticState): vscode.ThemeIcon {
  switch (state) {
    case "success":
      return new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    case "running":
      return new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor("charts.orange"),
      );
    case "queued":
      return new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor("testing.iconQueued"),
      );
    case "failure":
      return new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor("testing.iconFailed"),
      );
    case "cancelled":
      return new vscode.ThemeIcon(
        "circle-slash",
        new vscode.ThemeColor("disabledForeground"),
      );
    case "skipped":
      return new vscode.ThemeIcon(
        "circle-outline",
        new vscode.ThemeColor("testing.iconSkipped"),
      );
    default:
      return new vscode.ThemeIcon(
        "circle-outline",
        new vscode.ThemeColor("descriptionForeground"),
      );
  }
}

function cleanMetadata(value: string | undefined | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeWorkflowKey(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const refSeparator = normalized.indexOf("@");
  return refSeparator >= 0 ? normalized.slice(0, refSeparator) : normalized;
}

export function workflowLookupKeys(value?: string | null): string[] {
  const cleaned = cleanMetadata(value);
  if (!cleaned) return [];
  const normalized = normalizeWorkflowKey(cleaned);
  const basename = normalized.split("/").pop() ?? normalized;
  return [...new Set([cleaned, normalized, basename])].filter(Boolean);
}

function workflowFileDisplayName(value?: string | null): string | undefined {
  const keys = workflowLookupKeys(value);
  if (keys.length === 0) return undefined;
  const basename = keys[keys.length - 1];
  const stem = basename.replace(/\.(?:ya?ml)$/i, "").trim();
  return stem || undefined;
}

export function resolveWorkflowName(
  run: GiteaWorkflowRun,
  workflowNames: ReadonlyMap<string, string>,
): string | undefined {
  const candidates = [
    ...workflowLookupKeys(run.workflow_id),
    ...workflowLookupKeys(run.path),
  ];
  for (const candidate of candidates) {
    const resolved = cleanMetadata(workflowNames.get(candidate));
    if (resolved) return resolved;
  }
  return undefined;
}

export function isActiveRunStatus(status: string): boolean {
  return isCIActiveState(status);
}

export function displayStatusForRun(run: GiteaWorkflowRun): string {
  return ciStatusLabel(run.status, run.conclusion);
}

export function displayNameForRun(
  run: GiteaWorkflowRun,
  workflowName?: string,
): string {
  const name =
    cleanMetadata(workflowName) ??
    cleanMetadata(run.name) ??
    workflowFileDisplayName(run.path) ??
    workflowFileDisplayName(run.workflow_id) ??
    cleanMetadata(run.workflow_id) ??
    `Run #${run.run_number}`;
  const defaultBranch = cleanMetadata(run.repository?.default_branch);
  return defaultBranch ? `${name} (${defaultBranch})` : name;
}

export function formatRunDateTime(run: GiteaWorkflowRun): string | undefined {
  const raw = cleanMetadata(run.run_started_at) ?? cleanMetadata(run.created_at);
  if (!raw) return undefined;

  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return undefined;

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

export function ciRunsFingerprint(runs: readonly GiteaWorkflowRun[]): string {
  return runs
    .map((run) =>
      [
        run.id,
        run.status,
        run.conclusion,
        run.updated_at,
        run.head_sha,
      ].join(":"),
    )
    .join("|");
}

export function ciJobCacheKey(
  repoInfo: Pick<RepoInfo, "key">,
  runId: number,
): string {
  return `${repoInfo.key}:${runId}`;
}

export function formatArtifactSize(sizeInBytes?: number): string | undefined {
  if (sizeInBytes === undefined) return undefined;
  if (sizeInBytes < 1024) return `${sizeInBytes} B`;
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KiB`;
  if (sizeInBytes < 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function artifactFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, "-") || "artifact";
  return safe.toLowerCase().endsWith(".zip") ? safe : `${safe}.zip`;
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
    this.id = `repo:${repoInfo.key}`;
    this.contextValue = "repoGroup";
    this.description = repoInfo.currentBranch ? `(${repoInfo.currentBranch})` : "";
    this.iconPath = new vscode.ThemeIcon(authed ? "repo" : "repo-forked");
    this.tooltip = `${repoInfo.serverUrl}/${repoInfo.owner}/${repoInfo.repo}`;
  }
}

export class CIRunItem extends vscode.TreeItem {
  constructor(
    public readonly run: GiteaWorkflowRun,
    public readonly repoInfo: RepoInfo,
    workflowName?: string,
  ) {
    const displayName = displayNameForRun(run, workflowName);
    super(displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `run:${repoInfo.key}:${run.id}`;

    const presentation = runPresentation(run.status, run.conclusion, run.html_url);
    this.contextValue = presentation.actions.cancel
      ? "ciRun_active"
      : presentation.actions.rerun
        ? "ciRun_complete"
        : "ciRun_readonly";
    const secondaryMetadata = runSecondaryMetadata(run);
    this.description = [
      `#${run.run_number}`,
      presentation.statusLabel,
      ...secondaryMetadata,
    ].join(" · ");

    const tooltipLines = [
      `**${displayName}**`,
      "",
      `Run: \`#${run.run_number}\``,
      `Status: \`${presentation.statusLabel}\``,
    ];
    const workflowPath = cleanMetadata(run.path) ?? cleanMetadata(run.workflow_id);
    if (workflowPath) tooltipLines.push(`Workflow: \`${workflowPath}\``);
    const commitTitle = cleanMetadata(run.display_title);
    if (commitTitle && commitTitle !== displayName) {
      tooltipLines.push(`Commit title: ${commitTitle}`);
    }
    const event = cleanMetadata(run.event);
    if (event) tooltipLines.push(`Event: \`${event}\``);
    const dateTime = formatRunDateTime(run);
    if (dateTime) tooltipLines.push(`Date: ${dateTime}`);
    const branch = cleanMetadata(run.head_branch);
    const commitMessage = cleanMetadata(run.head_commit?.message);
    if (branch) tooltipLines.push("", `Branch: \`${branch}\``);
    if (commitMessage && commitMessage !== commitTitle) {
      tooltipLines.push(`Commit: ${commitMessage}`);
    }
    this.tooltip = new vscode.MarkdownString(tooltipLines.join("\n\n"));
    this.iconPath = iconForSemanticState(presentation.state);
  }
}

export class CIJobItem extends vscode.TreeItem {
  constructor(
    public readonly job: GiteaWorkflowJob,
    public readonly runId: number,
    public readonly repoInfo: RepoInfo,
  ) {
    const presentation = jobPresentation(job.status, job.conclusion, job.html_url);
    const embeddedSteps = normalizeStepDetails(job.steps);
    const hasSteps =
      embeddedSteps.availability === "available" && embeddedSteps.steps.length > 0;
    const detailUnknown = embeddedSteps.availability === "unavailable";

    super(
      job.name,
      hasSteps || detailUnknown
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `job:${repoInfo.key}:${runId}:${job.id}`;
    this.contextValue = presentation.actions.rerun
      ? "ciJob_complete"
      : presentation.state === "running" || presentation.state === "queued"
        ? "ciJob_active"
        : "ciJob_readonly";
    this.description = presentation.statusLabel;
    this.iconPath = iconForSemanticState(presentation.state);
    const stepHint = hasSteps
      ? `\n\n${embeddedSteps.steps.length} step(s)`
      : detailUnknown
        ? "\n\nStructured step detail loads on expand when available."
        : "";
    this.tooltip = `${job.name} — ${presentation.statusLabel}${stepHint}`;
  }
}

export class CIStepItem extends vscode.TreeItem {
  constructor(
    public readonly step: CIStepDetail,
    public readonly job: GiteaWorkflowJob,
    public readonly runId: number,
    public readonly repoInfo: RepoInfo,
  ) {
    super(step.name, vscode.TreeItemCollapsibleState.None);
    this.id = `step:${repoInfo.key}:${runId}:${job.id}:${step.number}`;
    this.contextValue = "ciStep";
    this.description = ciStatusLabel(step.status, step.conclusion);
    this.iconPath = iconForStatus(step.status ?? "", step.conclusion);
    this.tooltip = `${step.name} — ${this.description}`;
  }
}

export class CIUnavailableStepDetailItem extends vscode.TreeItem {
  constructor() {
    super(
      "Structured step detail unavailable — open Job Logs for full output",
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = "ciStepDetailUnavailable";
    this.iconPath = new vscode.ThemeIcon("info");
    this.tooltip =
      "This Gitea server/job did not expose authoritative structured steps. Text logs remain the canonical execution detail.";
  }
}

export class CIArtifactsGroupItem extends vscode.TreeItem {
  constructor(
    public readonly artifacts: readonly CIArtifactDetail[],
    public readonly runId: number,
    public readonly repoInfo: RepoInfo,
  ) {
    super(
      `Artifacts (${artifacts.length})`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `artifacts:${repoInfo.key}:${runId}`;
    this.contextValue = "ciArtifactsGroup";
    this.iconPath = new vscode.ThemeIcon("archive");
    this.tooltip = `${artifacts.length} workflow artifact(s). Downloads are explicit and never run in the background.`;
  }
}

export class CIArtifactItem extends vscode.TreeItem {
  constructor(
    public readonly artifact: CIArtifactDetail,
    public readonly runId: number,
    public readonly repoInfo: RepoInfo,
  ) {
    super(artifact.name, vscode.TreeItemCollapsibleState.None);
    this.id = `artifact:${repoInfo.key}:${runId}:${artifact.id}`;
    this.contextValue = artifact.expired ? "ciArtifact_expired" : "ciArtifact_available";
    const size = formatArtifactSize(artifact.sizeInBytes);
    this.description = [size, artifact.expired ? "expired" : undefined]
      .filter((value): value is string => !!value)
      .join(" · ");
    this.iconPath = new vscode.ThemeIcon(artifact.expired ? "circle-slash" : "package");
    const tooltip = [
      `Artifact: ${artifact.name}`,
      size ? `Size: ${size}` : undefined,
      artifact.expiresAt ? `Expires: ${artifact.expiresAt}` : undefined,
      artifact.expired ? "Status: expired/unavailable" : "Click to download explicitly.",
    ].filter((value): value is string => !!value);
    this.tooltip = tooltip.join("\n");
    if (!artifact.expired) {
      this.command = {
        command: "gitea.downloadArtifact",
        title: "Download Artifact",
        arguments: [this],
      };
    }
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

export class CIRunsProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly pollingStateEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangePollingState = this.pollingStateEmitter.event;

  private stateMap = new Map<string, RepoCIState>();
  private jobCache = new Map<string, GiteaWorkflowJob[]>();
  private workflowNameCache = new Map<string, Map<string, string>>();
  private readonly executionDetail: CIExecutionDetailService;
  private readonly actionsDetailApi: GiteaActionsDetailApi;
  private readonly artifactDetail: CIArtifactDetailService;

  constructor(
    private readonly api: GiteaApiClient,
    private readonly repoManager: RepoManager,
    private readonly auth: AuthManager,
  ) {
    this.executionDetail = new CIExecutionDetailService(api);
    this.actionsDetailApi = new GiteaActionsDetailApi(auth);
    this.artifactDetail = new CIArtifactDetailService(this.actionsDetailApi);
    repoManager.onDidChange(() => this.refresh());
    auth.onDidChangeSession(() => this.refresh());
  }

  refresh(): void {
    this.stateMap.clear();
    this.jobCache.clear();
    this.workflowNameCache.clear();
    this.executionDetail.clear();
    this.artifactDetail.clear();
    this._onDidChangeTreeData.fire();
    this.pollingStateEmitter.fire();
  }

  hasLoadedRepos(): boolean {
    return this.stateMap.size > 0;
  }

  hasActiveRuns(): boolean {
    for (const state of this.stateMap.values()) {
      if (state.runs.some((run) => isActiveRunStatus(run.status))) return true;
    }
    return false;
  }

  async pollLoadedRuns(): Promise<CIPollResult> {
    let changed = false;
    for (const [repoKey, state] of this.stateMap) {
      const repoInfo = this.repoManager.getRepos().find((repo) => repo.key === repoKey);
      if (!repoInfo || state.loading) continue;
      const repoChanged = await this.pollRepoFirstPage(repoInfo, state);
      if (repoChanged) {
        this.executionDetail.invalidateRepo(repoInfo);
        this.artifactDetail.invalidateRepo(repoInfo);
      }
      changed = repoChanged || changed;
    }
    if (changed) {
      this.jobCache.clear();
      this._onDidChangeTreeData.fire();
      this.pollingStateEmitter.fire();
    }
    return { changed, hasActiveRuns: this.hasActiveRuns() };
  }

  async refreshRepo(repoKey: string): Promise<void> {
    const state = this.stateMap.get(repoKey);
    if (state) {
      const wasLoading = state.loading;
      state.loading = false;
      state.page = 1;
      const repoInfo = this.repoManager.getRepos().find((r) => r.key === repoKey);
      if (repoInfo) {
        this.executionDetail.invalidateRepo(repoInfo);
        this.artifactDetail.invalidateRepo(repoInfo);
        for (const key of this.jobCache.keys()) {
          if (key.startsWith(`${repoInfo.key}:`)) this.jobCache.delete(key);
        }
        await this.fetchForRepo(repoInfo, state, true);
      }
      state.loading = wasLoading;
    }
  }

  async loadMore(repoKey: string): Promise<void> {
    const state = this.stateMap.get(repoKey);
    if (!state || state.loading || !state.hasMore) return;
    state.page += 1;
    const repoInfo = this.repoManager.getRepos().find((r) => r.key === repoKey);
    if (repoInfo) await this.fetchForRepo(repoInfo, state);
  }

  async downloadArtifact(item: CIArtifactItem): Promise<void> {
    if (item.artifact.expired) {
      vscode.window.showWarningMessage(
        `Artifact is expired or unavailable: ${item.artifact.name}`,
      );
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder, artifactFileName(item.artifact.name))
      : undefined;
    const destination = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: "Download Artifact",
      filters: { "ZIP archive": ["zip"] },
    });
    if (!destination) return;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading artifact ${item.artifact.name}...`,
      },
      async () => {
        try {
          const bytes = await this.actionsDetailApi.downloadWorkflowArtifact(
            item.repoInfo,
            item.artifact.id,
          );
          await vscode.workspace.fs.writeFile(destination, bytes);
          const action = await vscode.window.showInformationMessage(
            `Artifact downloaded: ${item.artifact.name}`,
            "Reveal",
          );
          if (action === "Reveal") {
            await vscode.commands.executeCommand("revealFileInOS", destination);
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Artifact download failed: ${(error as Error).message}`,
          );
        }
      },
    );
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
      return this.getRunChildren(element);
    }

    if (element instanceof CIArtifactsGroupItem) {
      return element.artifacts.map(
        (artifact) => new CIArtifactItem(artifact, element.runId, element.repoInfo),
      );
    }

    if (element instanceof CIJobItem) {
      return this.getStepsForJob(element);
    }

    return [];
  }

  private async getRunChildren(element: CIRunItem): Promise<vscode.TreeItem[]> {
    const jobs = await this.getJobsForRun(element.run.id, element.repoInfo);
    try {
      const artifacts = await this.artifactDetail.resolveRunArtifacts(
        element.repoInfo,
        element.run.id,
      );
      if (artifacts.availability === "available" && artifacts.artifacts.length > 0) {
        return [
          ...jobs,
          new CIArtifactsGroupItem(
            artifacts.artifacts,
            element.run.id,
            element.repoInfo,
          ),
        ];
      }
    } catch (error) {
      warn(
        `[ci] artifact metadata unavailable repo=${element.repoInfo.label} run=${element.run.id}: ${(error as Error).message}`,
      );
    }
    return jobs;
  }

  private async getRepoChildren(
    repoInfo: RepoInfo,
  ): Promise<vscode.TreeItem[]> {
    let state = this.stateMap.get(repoInfo.key);
    if (!state) {
      state = { runs: [], page: 1, hasMore: false, loading: false };
      this.stateMap.set(repoInfo.key, state);
      this.pollingStateEmitter.fire();
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
    const workflowNames = await this.getWorkflowNames(repoInfo);
    const items: vscode.TreeItem[] = state.runs.map(
      (run) =>
        new CIRunItem(
          run,
          repoInfo,
          resolveWorkflowName(run, workflowNames),
        ),
    );
    if (state.hasMore) items.push(new CILoadMoreItem(repoInfo.key));
    return items;
  }

  private async getWorkflowNames(repoInfo: RepoInfo): Promise<Map<string, string>> {
    const cached = this.workflowNameCache.get(repoInfo.key);
    if (cached) return cached;

    try {
      const workflows = await this.api.listWorkflows(repoInfo);
      const names = new Map<string, string>();
      for (const workflow of workflows) {
        const name = cleanMetadata(workflow.name);
        if (!name) continue;
        for (const key of [
          ...workflowLookupKeys(workflow.id),
          ...workflowLookupKeys(workflow.path),
        ]) {
          names.set(key, name);
        }
      }
      this.workflowNameCache.set(repoInfo.key, names);
      return names;
    } catch (error) {
      warn(
        `[ci] workflow metadata unavailable repo=${repoInfo.label}: ${(error as Error).message}`,
      );
      const empty = new Map<string, string>();
      this.workflowNameCache.set(repoInfo.key, empty);
      return empty;
    }
  }

  private async fetchForRepo(
    repoInfo: RepoInfo,
    state: RepoCIState,
    silentRefresh: boolean = false,
  ): Promise<void> {
    if (state.loading && !silentRefresh) return;
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
      if (shouldShowLoading) state.loading = false;
      this._onDidChangeTreeData.fire();
      this.pollingStateEmitter.fire();
    }
  }

  private async pollRepoFirstPage(
    repoInfo: RepoInfo,
    state: RepoCIState,
  ): Promise<boolean> {
    try {
      const config = vscode.workspace.getConfiguration("gitea");
      const limit: number = config.get<number>("itemsPerPage") ?? 20;
      const result = await this.api.listWorkflowRuns(
        repoInfo,
        undefined,
        1,
        limit,
      );
      const previousFirstPage = state.runs.slice(0, limit);
      const changed =
        ciRunsFingerprint(previousFirstPage) !== ciRunsFingerprint(result.items);
      if (!changed) return false;

      const firstPageIds = new Set(result.items.map((run) => run.id));
      const tail =
        state.page > 1
          ? state.runs.slice(limit).filter((run) => !firstPageIds.has(run.id))
          : [];
      state.runs = [...result.items, ...tail];
      if (state.page === 1) state.hasMore = result.hasMore;
      return true;
    } catch (error) {
      warn(
        `[polling] ci-runs failed repo=${repoInfo.label}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async getJobsForRun(
    runId: number,
    repoInfo: RepoInfo,
  ): Promise<vscode.TreeItem[]> {
    const cacheKey = ciJobCacheKey(repoInfo, runId);
    if (this.jobCache.has(cacheKey)) {
      return (this.jobCache.get(cacheKey) ?? []).map(
        (j) => new CIJobItem(j, runId, repoInfo),
      );
    }
    try {
      const jobs = await this.api.listWorkflowJobs(repoInfo, runId);
      this.jobCache.set(cacheKey, jobs);
      return jobs.map((j) => new CIJobItem(j, runId, repoInfo));
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to load jobs: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async getStepsForJob(element: CIJobItem): Promise<vscode.TreeItem[]> {
    try {
      const result = await this.executionDetail.resolveJobSteps(
        element.repoInfo,
        element.job,
      );
      if (result.availability === "unavailable") {
        return [new CIUnavailableStepDetailItem()];
      }
      return result.steps.map(
        (step) => new CIStepItem(step, element.job, element.runId, element.repoInfo),
      );
    } catch (error) {
      warn(
        `[ci] structured step detail unavailable repo=${element.repoInfo.label} run=${element.runId} job=${element.job.id}: ${(error as Error).message}`,
      );
      return [new CIUnavailableStepDetailItem()];
    }
  }

  dispose(): void {
    this.executionDetail.clear();
    this.artifactDetail.clear();
    this.pollingStateEmitter.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
