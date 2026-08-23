import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { CIRunsProvider, CIRunItem, CIJobItem, RepoGroupItem } from "../views/ciRunsProvider";
import { CIDetailPanel } from "../views/ciDetailPanel";
import { LiveLogPanel } from "../views/liveLogPanel";
import type { GiteaWorkflowRun } from "../api/types";
import type { RepoInfo } from "../context/repoManager";

export function registerCICommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  ciProvider: CIRunsProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitea.refreshCI", () =>
      ciProvider.refresh(),
    ),

    vscode.commands.registerCommand("gitea.refreshRepo", async (arg: RepoGroupItem) => {
      if (arg instanceof RepoGroupItem) {
        await ciProvider.refreshRepo(arg.repoInfo.key);
        vscode.window.showInformationMessage(`Refreshed CI runs for ${arg.repoInfo.label}`);
      }
    }),

    vscode.commands.registerCommand("gitea.refreshJob", async (arg: CIJobItem) => {
      if (arg instanceof CIJobItem) {
        await ciProvider.refreshJob(arg.job.id, arg.runId, arg.repoInfo);
        vscode.window.showInformationMessage(`Refreshed job: ${arg.job.name}`);
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
      "gitea.viewCIDetail",
      async (arg: CIRunItem) => {
        if (!(arg instanceof CIRunItem)) {
          return;
        }
        await CIDetailPanel.show(api, arg.repoInfo, arg.run);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.rerunWorkflow",
      async (arg: CIRunItem | GiteaWorkflowRun) => {
        const run = arg instanceof CIRunItem ? arg.run : arg;
        const repoInfo = arg instanceof CIRunItem ? arg.repoInfo : undefined;
        if (!repoInfo) {
          vscode.window.showErrorMessage(
            "Cannot determine repository for this run.",
          );
          return;
        }
        await rerunWorkflow(api, repoInfo, run, ciProvider);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.cancelRun",
      async (arg: CIRunItem | GiteaWorkflowRun) => {
        const run = arg instanceof CIRunItem ? arg.run : arg;
        const repoInfo = arg instanceof CIRunItem ? arg.repoInfo : undefined;
        if (!repoInfo) {
          vscode.window.showErrorMessage(
            "Cannot determine repository for this run.",
          );
          return;
        }
        await cancelRun(api, repoInfo, run, ciProvider);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.viewLogs",
      async (arg: CIJobItem) => {
        if (!(arg instanceof CIJobItem)) {
          vscode.window.showWarningMessage("Select a job to view its logs.");
          return;
        }
        await LiveLogPanel.show(api, arg.repoInfo, arg.job);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.rerunJob",
      async (arg: CIJobItem) => {
        if (!(arg instanceof CIJobItem)) {
          vscode.window.showWarningMessage("Select a job to re-run.");
          return;
        }
        await rerunJob(api, arg, ciProvider);
      },
    ),
  );
}

async function rerunWorkflow(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  run: GiteaWorkflowRun,
  ciProvider: CIRunsProvider,
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Re-run workflow run #${run.run_number}?`,
    { modal: true },
    "Re-run",
  );
  if (confirm !== "Re-run") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Triggering re-run...",
    },
    async () => {
      try {
        await api.rerunWorkflow(repoInfo, run.id);
        vscode.window.showInformationMessage("Re-run triggered.");
        setTimeout(() => ciProvider.refresh(), 2000);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Re-run failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

async function rerunJob(
  api: GiteaApiClient,
  item: CIJobItem,
  ciProvider: CIRunsProvider,
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Re-run job ${item.job.name}?`,
    { modal: true },
    "Re-run Job",
  );
  if (confirm !== "Re-run Job") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Re-running ${item.job.name}...`,
    },
    async () => {
      try {
        await api.rerunWorkflowJob(item.repoInfo, item.runId, item.job.id);
        vscode.window.showInformationMessage(`Job re-run triggered: ${item.job.name}`);
        setTimeout(() => ciProvider.refresh(), 2000);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Job re-run failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

async function cancelRun(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  run: GiteaWorkflowRun,
  ciProvider: CIRunsProvider,
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Cancel run #${run.run_number}?`,
    { modal: true },
    "Cancel Run",
  );
  if (confirm !== "Cancel Run") {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Cancelling run...",
    },
    async () => {
      try {
        await api.cancelWorkflowRun(repoInfo, run.id);
        vscode.window.showInformationMessage("Run cancelled.");
        setTimeout(() => ciProvider.refresh(), 1500);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Cancel failed: ${(err as Error).message}`,
        );
      }
    },
  );
}
