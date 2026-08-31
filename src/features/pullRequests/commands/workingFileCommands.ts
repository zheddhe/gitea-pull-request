import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import { info } from "../../../debug/outputChannel";
import { PRDiffFileItem, PRDiffProvider } from "../../../views/prDiffProvider";
import type { ConflictResolutionService } from "../services/conflictResolutionService";
import type { WorkingFileBridgeService } from "../services/workingFileBridgeService";

export function registerWorkingFileCommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  conflictResolution: ConflictResolutionService,
  workingFileBridge: WorkingFileBridgeService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitea.openEditablePRDiff",
      async (fileItem: PRDiffFileItem) => {
        const provider = PRDiffProvider.getActive();
        if (!provider || !fileItem) return;

        const repoInfo = provider.repoInfo;
        const pr = provider.pr;
        const resolved = await workingFileBridge.resolve(
          repoInfo,
          pr,
          fileItem.filename,
        );
        if (resolved.kind === "unavailable") {
          vscode.window.showInformationMessage(
            editableDiffUnavailableMessage(
              resolved.reason,
              pr.head.repo.full_name,
              pr.head.ref,
              resolved.currentBranch,
              fileItem.filename,
            ),
          );
          return;
        }

        try {
          const [baseText, headText, localBytes] = await Promise.all([
            api.getFileContents(repoInfo, pr.base.ref, fileItem.filename).catch(() => ""),
            api.getFileContents(repoInfo, pr.head.ref, fileItem.filename),
            vscode.workspace.fs.readFile(resolved.uri),
          ]);
          const localText = Buffer.from(localBytes).toString("utf8");
          if (baseText.includes("\0") || headText.includes("\0") || localText.includes("\0")) {
            vscode.window.showInformationMessage(
              `File '${fileItem.filename}' appears to be binary — editable diff is unavailable.`,
            );
            return;
          }

          // Enter edit mode only from an exact PR-head baseline. After the
          // diff opens, the right side is intentionally the working tree and
          // may diverge as the developer edits it. Review anchors remain tied
          // to the separate snapshot PR diff.
          if (localText !== headText) {
            vscode.window.showWarningMessage(
              `Editable diff unavailable: local '${fileItem.filename}' already differs from PR head ${pr.head.sha.slice(0, 8)}. Open the Review Diff for authoritative PR state, or synchronize the working tree first.`,
            );
            info(
              `[editable-diff] refused repo=${repoInfo.key} pr=#${pr.number} file=${fileItem.filename} reason=localDiffersFromHead`,
            );
            return;
          }

          const tmpDir = path.join(
            os.tmpdir(),
            `gitea-edit-diff-${repoInfo.key.replace(/[^a-zA-Z0-9]/g, "_")}-${pr.number}-${Date.now()}`,
          );
          const baseUri = vscode.Uri.file(path.join(tmpDir, ".base", fileItem.filename));
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(baseUri.fsPath)));
          await vscode.workspace.fs.writeFile(baseUri, Buffer.from(baseText, "utf8"));

          await vscode.commands.executeCommand(
            "vscode.diff",
            baseUri,
            resolved.uri,
            `LOCAL EDIT · PR #${pr.number} — ${fileItem.filename}`,
            { preview: false, preserveFocus: false },
          );
          info(
            `[editable-diff] opened repo=${repoInfo.key} pr=#${pr.number} head=${pr.head.sha.slice(0, 8)} branch=${pr.head.ref} file=${fileItem.filename}`,
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to open editable PR diff for '${fileItem.filename}': ${(error as Error).message}`,
          );
        }
      },
    ),

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

function editableDiffUnavailableMessage(
  reason: "sourceRepositoryNotInWorkspace" | "sourceBranchNotCheckedOut" | "pathOutsideWorkspace" | "fileNotFound",
  sourceRepository: string,
  expectedBranch: string,
  currentBranch: string | undefined,
  filename: string,
): string {
  switch (reason) {
    case "sourceRepositoryNotInWorkspace":
      return `Editable diff unavailable: PR source repository '${sourceRepository}' is not open in this workspace.`;
    case "sourceBranchNotCheckedOut":
      return `Editable diff unavailable: source branch '${expectedBranch}' is not checked out${currentBranch ? ` (current: '${currentBranch}')` : ""}.`;
    case "fileNotFound":
      return `Editable diff unavailable: '${filename}' does not exist in the checked-out source workspace.`;
    case "pathOutsideWorkspace":
      return `Editable diff unavailable: '${filename}' resolves outside the source workspace.`;
  }
}
