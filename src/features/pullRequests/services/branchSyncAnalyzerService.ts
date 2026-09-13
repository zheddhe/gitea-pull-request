import { execFile } from "child_process";
import { promisify } from "util";
import type { RepoInfo } from "../../../context/repoManager";
import { debug, warn } from "../../../debug/outputChannel";
import type { BranchIdentity } from "./branchCleanupService";

const execFileAsync = promisify(execFile);

export type BranchSyncState =
  | "in-sync"
  | "local-behind"
  | "local-ahead"
  | "diverged"
  | "unknown";

export interface BranchSyncDiagnostic {
  state: BranchSyncState;
  localOnly: number;
  remoteOnly: number;
  localRef?: string;
  remoteRef?: string;
  remoteMatchesPrHead?: boolean;
  reason?: string;
}

export interface BranchSyncGit {
  revListLeftRightCount(
    repoInfo: RepoInfo,
    localRef: string,
    remoteRef: string,
  ): Promise<{ localOnly: number; remoteOnly: number }>;
  resolveRef(repoInfo: RepoInfo, ref: string): Promise<string>;
}

export function classifyBranchSync(
  localOnly: number,
  remoteOnly: number,
): BranchSyncState {
  if (localOnly === 0 && remoteOnly === 0) return "in-sync";
  if (localOnly === 0 && remoteOnly > 0) return "local-behind";
  if (localOnly > 0 && remoteOnly === 0) return "local-ahead";
  if (localOnly > 0 && remoteOnly > 0) return "diverged";
  return "unknown";
}

function commitLabel(count: number): string {
  return `${count} local commit${count === 1 ? "" : "s"}`;
}

export function preMergeBranchSyncWarning(
  diagnostic: BranchSyncDiagnostic,
): string | undefined {
  switch (diagnostic.state) {
    case "in-sync":
    case "local-behind":
      return undefined;
    case "local-ahead":
      return `${commitLabel(diagnostic.localOnly)} ${diagnostic.localOnly === 1 ? "is" : "are"} not part of this pull request. Merging now will merge only the remote PR head.`;
    case "diverged":
      return `Source branches have diverged: ${diagnostic.localOnly} local-only / ${diagnostic.remoteOnly} remote-only commit${diagnostic.remoteOnly === 1 ? "" : "s"}. Local-only work is not part of this pull request.`;
    case "unknown": {
      const detail = diagnostic.reason ? ` ${diagnostic.reason}` : "";
      return `Local source branch synchronization could not be verified.${detail}`;
    }
  }
}

export function parseLeftRightCount(output: string): {
  localOnly: number;
  remoteOnly: number;
} {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) throw new Error(`Unexpected git rev-list count output: ${output.trim()}`);
  return {
    localOnly: Number(match[1]),
    remoteOnly: Number(match[2]),
  };
}

class SystemBranchSyncGit implements BranchSyncGit {
  async revListLeftRightCount(
    repoInfo: RepoInfo,
    localRef: string,
    remoteRef: string,
  ): Promise<{ localOnly: number; remoteOnly: number }> {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--left-right", "--count", `${localRef}...${remoteRef}`],
      { cwd: repoInfo.rootPath, encoding: "utf8" },
    );
    return parseLeftRightCount(String(stdout));
  }

  async resolveRef(repoInfo: RepoInfo, ref: string): Promise<string> {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--verify", ref],
      { cwd: repoInfo.rootPath, encoding: "utf8" },
    );
    return String(stdout).trim();
  }
}

export class BranchSyncAnalyzerService {
  constructor(private readonly git: BranchSyncGit = new SystemBranchSyncGit()) {}

  async analyze(
    repoInfo: RepoInfo,
    identity: BranchIdentity,
    prHeadSha: string,
  ): Promise<BranchSyncDiagnostic> {
    const localRef = identity.localHead;
    const remoteRef = identity.remoteHead?.refName;
    if (!localRef || !remoteRef) {
      return {
        state: "unknown",
        localOnly: 0,
        remoteOnly: 0,
        localRef,
        remoteRef,
        reason: !localRef
          ? "Local source branch is not safely mapped in this workspace."
          : "Remote source branch is not safely mapped in this workspace.",
      };
    }

    try {
      const remoteSha = await this.git.resolveRef(repoInfo, remoteRef);
      const remoteMatchesPrHead = remoteSha === prHeadSha;
      if (!remoteMatchesPrHead) {
        return {
          state: "unknown",
          localOnly: 0,
          remoteOnly: 0,
          localRef,
          remoteRef,
          remoteMatchesPrHead,
          reason:
            "Fetched remote source does not match the authoritative pull request head.",
        };
      }

      const counts = await this.git.revListLeftRightCount(
        repoInfo,
        localRef,
        remoteRef,
      );
      const state = classifyBranchSync(counts.localOnly, counts.remoteOnly);
      debug(
        `[branch-sync] repo=${repoInfo.label} local=${localRef} remote=${remoteRef} state=${state} localOnly=${counts.localOnly} remoteOnly=${counts.remoteOnly}`,
      );
      return {
        state,
        ...counts,
        localRef,
        remoteRef,
        remoteMatchesPrHead,
      };
    } catch (error) {
      warn(
        `[branch-sync] analysis failed repo=${repoInfo.label} local=${localRef} remote=${remoteRef}: ${(error as Error).message}`,
      );
      return {
        state: "unknown",
        localOnly: 0,
        remoteOnly: 0,
        localRef,
        remoteRef,
        reason: (error as Error).message,
      };
    }
  }
}
