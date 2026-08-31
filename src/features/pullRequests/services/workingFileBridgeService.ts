import * as path from "path";
import * as vscode from "vscode";
import type { GiteaPullRequest } from "../../../api/types";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";
import { info } from "../../../debug/outputChannel";
import {
  evaluateWorkingFileBridge,
  type WorkingRepositoryCandidate,
} from "../domain/workingFileBridge";

export type ResolveWorkingFileResult =
  | { kind: "resolved"; uri: vscode.Uri }
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

export type OpenWorkingFileResult =
  | { kind: "opened"; uri: vscode.Uri }
  | Exclude<ResolveWorkingFileResult, { kind: "resolved" }>;

export class WorkingFileBridgeService {
  constructor(private readonly repoManager: RepoManager) {}

  async resolve(
    activeRepo: RepoInfo,
    pr: GiteaPullRequest,
    filename: string,
  ): Promise<ResolveWorkingFileResult> {
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

    return this.resolveFromVerifiedWorkspace(decision.repository, pr, filename);
  }

  async open(
    activeRepo: RepoInfo,
    pr: GiteaPullRequest,
    filename: string,
  ): Promise<OpenWorkingFileResult> {
    const result = await this.resolve(activeRepo, pr, filename);
    if (result.kind === "unavailable") return result;

    await vscode.window.showTextDocument(result.uri, {
      preview: false,
      preserveFocus: false,
    });
    info(
      `[working-file] opened repo=${activeRepo.key} pr=#${pr.number} branch=${pr.head.ref} file=${filename}`,
    );
    return { kind: "opened", uri: result.uri };
  }

  async openPrepared(
    preparedRepo: RepoInfo,
    pr: GiteaPullRequest,
    filename: string,
  ): Promise<OpenWorkingFileResult> {
    const result = await this.resolveFromVerifiedWorkspace(preparedRepo, pr, filename);
    if (result.kind === "unavailable") return result;

    await vscode.window.showTextDocument(result.uri, {
      preview: false,
      preserveFocus: false,
    });
    info(
      `[working-file] opened repo=${preparedRepo.key} pr=#${pr.number} branch=${pr.head.ref} file=${filename}`,
    );
    return { kind: "opened", uri: result.uri };
  }

  private async resolveFromVerifiedWorkspace(
    repoInfo: WorkingRepositoryCandidate,
    pr: GiteaPullRequest,
    filename: string,
  ): Promise<ResolveWorkingFileResult> {
    const root = path.resolve(repoInfo.rootPath);
    const target = path.resolve(root, filename);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      info(
        `[working-file] unavailable repo=${repoInfo.key} pr=#${pr.number} file=${filename} reason=pathOutsideWorkspace`,
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
        `[working-file] unavailable repo=${repoInfo.key} pr=#${pr.number} file=${filename} reason=fileNotFound`,
      );
      return { kind: "unavailable", reason: "fileNotFound" };
    }

    info(
      `[working-file] resolved repo=${repoInfo.key} pr=#${pr.number} branch=${pr.head.ref} file=${filename}`,
    );
    return { kind: "resolved", uri };
  }
}
