import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import {
  CIRunsProvider,
  CIRunItem,
  CIJobItem,
  CIArtifactItem,
  RepoGroupItem,
} from "../views/ciRunsProvider";
import { LiveLogPanel } from "../views/liveLogPanel";
import type { GiteaWorkflowJob, GiteaWorkflowRun } from "../api/types";
import type { RepoInfo } from "../context/repoManager";
import {
  jobPresentation,
  runPresentation,
} from "../features/ci/domain/ciPresentation";
import { CIContextualAccessService } from "../features/ci/services/ciContextualAccessService";
import type { CIRunsPollingService } from "../features/polling/services/ciRunsPollingService";
import type { PollingLifecycleSignalService } from "../features/polling/services/pollingLifecycleSignalService";
import type { PollingScheduler } from "../features/polling/services/pollingScheduler";

export interface CIJobLogTarget {
  repoInfo: RepoInfo;
  job: GiteaWorkflowJob;
}

interface ContextualJobQuickPickItem extends vscode.QuickPickItem {
  job: GiteaWorkflowJob;
}

export type ContextualJobResolution =
  | { kind: "job"; job: GiteaWorkflowJob }
  | { kind: "ambiguous" }
  | { kind: "not-found" };

export function resolveContextualJob(
  jobs: readonly GiteaWorkflowJob[],
  jobId?: number,
): ContextualJobResolution {
  if (jobId !== undefined) {
    const job = jobs.find((candidate) => candidate.id === jobId);
    return job ? { kind: "job", job } : { kind: "not-found" };
  }
  if (jobs.length === 1) return { kind: "job", job: jobs[0] };
  if (jobs.length > 1) return { kind: "ambiguous" };
  return { kind: "not-found" };
}

export function registerCICommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  ciProvider: CIRunsProvider,
  ciPolling: CIRunsPollingService,
  pollingScheduler: PollingScheduler,
  pollingSignals: PollingLifecycleSignalService,
): void {
  const contextualAccess = new CIContextualAccessService(api, ciProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.refreshCI", () => ciProvider.refresh()),

    vscode.commands.registerCommand("gitea.refreshRepo", async (arg: RepoGroupItem) => {
      if (arg instanceof RepoGroupItem) {
        await ciProvider.refreshRepo(arg.repoInfo.key);
        vscode.window.showInformationMessage(`Refreshed CI runs for ${arg.repoInfo.label}`);
      }
    }),

    vscode.commands.registerCommand("gitea.loadMoreCI", (repoKey: string) => {
      ciProvider.loadMore(repoKey);
    }),

    vscode.commands.registerCommand(
      "gitea.openRunInBrowser",
      async (arg: CIRunItem | GiteaWorkflowRun) => {
        const run = arg instanceof CIRunItem ? arg.run : arg;
        await vscode.env.openExternal(vscode.Uri.parse(run.html_url));
      },
    ),

    vscode.commands.registerCommand(
      "gitea.rerunWorkflow",
      async (arg: CIRunItem | GiteaWorkflowRun) => {
        const run = arg instanceof CIRunItem ? arg.run : arg;
        const repoInfo = arg instanceof CIRunItem ? arg.repoInfo : undefined;
        if (!repoInfo) {
          vscode.window.showErrorMessage("Cannot determine repository for this run.");
          return;
        }
        await rerunWorkflow(api, repoInfo, run, ciPolling);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.cancelRun",
      async (arg: CIRunItem | GiteaWorkflowRun) => {
        const run = arg instanceof CIRunItem ? arg.run : arg;
        const repoInfo = arg instanceof CIRunItem ? arg.repoInfo : undefined;
        if (!repoInfo) {
          vscode.window.showErrorMessage("Cannot determine repository for this run.");
          return;
        }
        await cancelRun(api, repoInfo, run, ciPolling);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.viewLogs",
      async (arg: CIJobItem | CIJobLogTarget) => {
        const target = jobLogTarget(arg);
        if (!target) {
          vscode.window.showWarningMessage("Select a job to view its logs.");
          return;
        }
        await openJobLogs(
          api,
          target,
          pollingScheduler,
          pollingSignals,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.inspectCheckJobs",
      async (repoInfo: RepoInfo, runId: number, jobId?: number) => {
        if (!repoInfo || !Number.isSafeInteger(runId) || runId <= 0) {
          vscode.window.showWarningMessage("Invalid Gitea Actions run identifier.");
          return;
        }
        if (
          jobId !== undefined &&
          (!Number.isSafeInteger(jobId) || jobId <= 0)
        ) {
          vscode.window.showWarningMessage("Invalid Gitea Actions job identifier.");
          return;
        }

        const jobs = await contextualAccess.loadJobsForRun(repoInfo, runId);
        const resolution = resolveContextualJob(jobs, jobId);

        if (resolution.kind === "not-found") {
          if (jobId !== undefined) {
            vscode.window.showWarningMessage(
              `Job #${jobId} is no longer available for Actions run #${runId}. Refresh the pull request and try again.`,
            );
          } else {
            vscode.window.showInformationMessage(
              `No jobs are available for Actions run #${runId}.`,
            );
          }
          return;
        }

        let job: GiteaWorkflowJob | undefined;
        if (resolution.kind === "job") {
          job = resolution.job;
        } else {
          const items: ContextualJobQuickPickItem[] = jobs.map((candidate) => {
            const presentation = jobPresentation(
              candidate.status,
              candidate.conclusion,
              candidate.html_url,
            );
            return {
              label: `${contextualJobIcon(presentation.state)} ${candidate.name}`,
              description: presentation.statusLabel,
              detail: `Actions run #${runId} · Job #${candidate.id}`,
              job: candidate,
            };
          });
          job = (
            await vscode.window.showQuickPick(items, {
              title: `Actions run #${runId} jobs`,
              placeHolder: "Select a job to inspect its logs",
              matchOnDescription: true,
              matchOnDetail: true,
            })
          )?.job;
        }

        if (!job) return;
        await vscode.commands.executeCommand("gitea.viewLogs", { repoInfo, job });
      },
    ),

    vscode.commands.registerCommand(
      "gitea.rerunJob",
      async (arg: CIJobItem) => {
        if (!(arg instanceof CIJobItem)) {
          vscode.window.showWarningMessage("Select a job to re-run.");
          return;
        }
        await rerunJob(api, arg, ciPolling);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.downloadArtifact",
      async (arg: CIArtifactItem) => {
        if (!(arg instanceof CIArtifactItem)) {
          vscode.window.showWarningMessage("Select an artifact to download.");
          return;
        }
        await ciProvider.downloadArtifact(arg);
      },
    ),
  );
}

function jobLogTarget(arg: CIJobItem | CIJobLogTarget | undefined): CIJobLogTarget | undefined {
  if (arg instanceof CIJobItem) {
    return { repoInfo: arg.repoInfo, job: arg.job };
  }
  if (arg?.repoInfo && arg.job) return arg;
  return undefined;
}

function contextualJobIcon(state: ReturnType<typeof jobPresentation>["state"]): string {
  switch (state) {
    case "success":
      return "$(pass-filled)";
    case "running":
      return "$(sync~spin)";
    case "queued":
      return "$(clock)";
    case "failure":
      return "$(error)";
    case "cancelled":
      return "$(circle-slash)";
    case "skipped":
      return "$(debug-step-over)";
    case "warning":
      return "$(warning)";
    default:
      return "$(question)";
  }
}

export async function openJobLogs(
  api: GiteaApiClient,
  target: CIJobLogTarget,
  pollingScheduler: PollingScheduler,
  pollingSignals: PollingLifecycleSignalService,
): Promise<void> {
  await LiveLogPanel.show(
    api,
    target.repoInfo,
    target.job,
    pollingScheduler,
    pollingSignals,
  );
}

export function canRerunWorkflow(run: GiteaWorkflowRun): boolean {
  return runPresentation(run.status, run.conclusion, run.html_url).actions.rerun;
}

export function canCancelWorkflow(run: GiteaWorkflowRun): boolean {
  return runPresentation(run.status, run.conclusion, run.html_url).actions.cancel;
}

export function canRerunJob(item: Pick<CIJobItem, "job">): boolean {
  return jobPresentation(
    item.job.status,
    item.job.conclusion,
    item.job.html_url,
  ).actions.rerun;
}

async function rerunWorkflow(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  run: GiteaWorkflowRun,
  ciPolling: CIRunsPollingService,
): Promise<void> {
  if (!canRerunWorkflow(run)) {
    vscode.window.showWarningMessage(
      `Run #${run.run_number} cannot be re-run in its current state (${run.status || "unknown"}).`,
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Re-run workflow run #${run.run_number}?`,
    { modal: true },
    "Re-run",
  );
  if (confirm !== "Re-run") return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Triggering re-run...",
    },
    async () => {
      try {
        await api.rerunWorkflow(repoInfo, run.id);
        vscode.window.showInformationMessage("Re-run triggered.");
        ciPolling.accelerate();
      } catch (err) {
        vscode.window.showErrorMessage(`Re-run failed: ${(err as Error).message}`);
      }
    },
  );
}

async function rerunJob(
  api: GiteaApiClient,
  item: CIJobItem,
  ciPolling: CIRunsPollingService,
): Promise<void> {
  if (!canRerunJob(item)) {
    vscode.window.showWarningMessage(
      `Job ${item.job.name} cannot be re-run in its current state (${item.job.status || "unknown"}).`,
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Re-run job ${item.job.name}?`,
    { modal: true },
    "Re-run Job",
  );
  if (confirm !== "Re-run Job") return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Re-running ${item.job.name}...`,
    },
    async () => {
      try {
        await api.rerunWorkflowJob(item.repoInfo, item.runId, item.job.id);
        vscode.window.showInformationMessage(`Job re-run triggered: ${item.job.name}`);
        ciPolling.accelerate();
      } catch (err) {
        vscode.window.showErrorMessage(`Job re-run failed: ${(err as Error).message}`);
      }
    },
  );
}

async function cancelRun(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  run: GiteaWorkflowRun,
  ciPolling: CIRunsPollingService,
): Promise<void> {
  if (!canCancelWorkflow(run)) {
    vscode.window.showWarningMessage(
      `Run #${run.run_number} cannot be cancelled in its current state (${run.status || "unknown"}).`,
    );
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Cancel run #${run.run_number}?`,
    { modal: true },
    "Cancel Run",
  );
  if (confirm !== "Cancel Run") return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Cancelling run...",
    },
    async () => {
      try {
        await api.cancelWorkflowRun(repoInfo, run.id);
        vscode.window.showInformationMessage("Run cancelled.");
        ciPolling.accelerate();
      } catch (err) {
        vscode.window.showErrorMessage(`Cancel failed: ${(err as Error).message}`);
      }
    },
  );
}
