import * as path from "path";
import * as vscode from "vscode";
import type { GiteaPullRequest } from "../../../api/types";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";
import { info } from "../../../debug/outputChannel";
import { evaluateWorkingFileBridge } from "../domain/workingFileBridge";

export type OpenWorkingFileResult =
  | { kind: "opened"; uri: vscode.Uri }
  | {
      kind: "unavailable";
      reason:
        | "sourceRepositoryNotInWorkspace"
        | "sourceBranchNotCheckedOut"
        | "pathOutsideWorkspace"
        | "fileNotFound";
      expectedBranch?: string;
      currentBranch?: string;
    };

export class WorkingFileBridgeService {
  constructor(private readonly repoManager: RepoManager) {}

  async open(
    activeRepo: RepoInfo,
    pr: GiteaPullRequest,
    filename: string,
  ): Promise<OpenWorkingFileResult> {
    const decision = evaluateWorkingFileBridge(
      activeRepo.serverUrl,
      pr.head.repo.full_name,
      pr.head.ref,
      this.repoManager.getRepos(),
    );

    if (decision.kind === "unavailable") {
      info(
        `[working-file] unavailable repo=${activeRepo.key} pr=#${pr.number} file=${filename} reason=${decision.reason}`,
      );
      return {
        kind: "unavailable",
        reason: decision.reason,
        expectedBranch: pr.head.ref,
        currentBranch: decision.repository?.currentBranch,
      };
    }

    const root = path.resolve(decision.repository.rootPath);
    const target = path.resolve(root, filename);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      info(
        `[working-file] unavailable repo=${activeRepo.key} pr=#${pr.number} file=${filename} reason=pathOutsideWorkspace`,
      );
      return { kind: "unavailable", reason: "pathOutsideWorkspace" };
    }

    const uri = vscode.Uri.file(target);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.File) === 0) {
        throw new Error("not a file");
      }
    } catch {
      info(
        `[working-file] unavailable repo=${activeRepo.key} pr=#${pr.number} file=${filename} reason=fileNotFound`,
      );
      return { kind: "unavailable", reason: "fileNotFound" };
    }

    await vscode.window.showTextDocument(uri, {
      preview: false,
      preserveFocus: false,
    });
    info(
      `[working-file] opened repo=${activeRepo.key} pr=#${pr.number} branch=${pr.head.ref} file=${filename}`,
    );
    return { kind: "opened", uri };
  }
}
