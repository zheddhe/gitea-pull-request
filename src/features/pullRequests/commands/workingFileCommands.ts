import * as vscode from "vscode";
import { info } from "../../../debug/outputChannel";
import { PRDiffFileItem, PRDiffProvider } from "../../../views/prDiffProvider";
import type { ConflictResolutionService } from "../services/conflictResolutionService";
import type { WorkingFileBridgeService } from "../services/workingFileBridgeService";

export function registerWorkingFileCommands(
  context: vscode.ExtensionContext,
  conflictResolution: ConflictResolutionService,
  workingFileBridge: WorkingFileBridgeService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitea.checkoutSourceAndOpenWorkingFile",
      async (fileItem: PRDiffFileItem) => {
        const provider = PRDiffProvider.getActive();
        if (!provider || !fileItem) return;

        const repoInfo = provider.repoInfo;
        const pr = provider.pr;
        const confirmation = await vscode.window.showWarningMessage(
          `Checkout pull request source branch '${pr.head.ref}' and open '${fileItem.filename}'?`,
          { modal: true },
          "Checkout Source and Open File",
        );
        if (confirmation !== "Checkout Source and Open File") return;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Preparing PR source branch '${pr.head.ref}'...`,
            },
            async () => {
              await conflictResolution.prepareSourceBranch(repoInfo, pr);
            },
          );

          const opened = await workingFileBridge.openPrepared(
            repoInfo,
            pr,
            fileItem.filename,
          );
          if (opened.kind === "opened") {
            info(
              `[working-file] checkout-and-open repo=${repoInfo.key} pr=#${pr.number} branch=${pr.head.ref} file=${fileItem.filename}`,
            );
            return;
          }

          if (opened.reason === "fileNotFound") {
            vscode.window.showInformationMessage(
              `Source branch prepared, but '${fileItem.filename}' does not exist in the resulting working tree.`,
            );
            return;
          }
          if (opened.reason === "pathOutsideWorkspace") {
            vscode.window.showWarningMessage(
              `Source branch prepared, but '${fileItem.filename}' resolves outside the workspace and will not be opened.`,
            );
            return;
          }

          vscode.window.showInformationMessage(
            `Source branch '${pr.head.ref}' was prepared, but the working file could not be opened safely.`,
          );
        } catch (error) {
          vscode.window.showWarningMessage(
            `Cannot prepare pull request source branch: ${(error as Error).message}`,
          );
        }
      },
    ),
  );
}
