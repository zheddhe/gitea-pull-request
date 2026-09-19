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

export type RemoteHeadState =
  | "in-sync"
  | "remote-ahead"
  | "remote-behind"
  | "diverged"
  | "absent"
  | "unknown";

export interface RemoteHeadDiagnostic {
  state: RemoteHeadState;
  remoteOnly: number;
  prHeadOnly: number;
  remoteRef?: string;
  reason?: string;
}

export interface PostMergeBranchSafetyDiagnostic {
  local?: BranchSyncDiagnostic;
  remote: RemoteHeadDiagnostic;
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

export function classifyRemoteHead(
  remoteOnly: number,
  prHeadOnly: number,
): RemoteHeadState {
  if (remoteOnly === 0 && prHeadOnly === 0) return "in-sync";
  if (remoteOnly > 0 && prHeadOnly === 0) return "remote-ahead";
  if (remoteOnly === 0 && prHeadOnly > 0) return "remote-behind";
  if (remoteOnly > 0 && prHeadOnly > 0) return "diverged";
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

export function localCleanupSafetyMessage(
  diagnostic: BranchSyncDiagnostic | undefined,
): string | undefined {
  if (!diagnostic) return undefined;
  switch (diagnostic.state) {
    case "in-sync":
    case "local-behind":
      return undefined;
    case "local-ahead":
      return `${commitLabel(diagnostic.localOnly)} ${diagnostic.localOnly === 1 ? "was" : "were"} not part of the merged pull request. The local branch will be kept.`;
    case "diverged":
      return `The local source branch diverged from the merged PR head: ${diagnostic.localOnly} local-only / ${diagnostic.remoteOnly} PR-only commit${diagnostic.remoteOnly === 1 ? "" : "s"}. The local branch will be kept.`;
    case "unknown": {
      const detail = diagnostic.reason ? ` ${diagnostic.reason}` : "";
      return `Local branch safety could not be verified, so the local branch will be kept.${detail}`;
    }
  }
}

export function remoteCleanupSafetyMessage(
  diagnostic: RemoteHeadDiagnostic,
): string | undefined {
  switch (diagnostic.state) {
    case "in-sync":
    case "absent":
      return undefined;
    case "remote-ahead":
      return `The remote source branch contains ${diagnostic.remoteOnly} commit${diagnostic.remoteOnly === 1 ? "" : "s"} added after the PR head that was merged. The remote branch will be kept.`;
    case "remote-behind":
      return "The fetched remote source no longer matches the PR head that was merged. The remote branch will be kept.";
    case "diverged":
      return `The remote source branch diverged after the merge: ${diagnostic.remoteOnly} remote-only / ${diagnostic.prHeadOnly} PR-head-only commit${diagnostic.prHeadOnly === 1 ? "" : "s"}. The remote branch will be kept.`;
    case "unknown": {
      const detail = diagnostic.reason ? ` ${diagnostic.reason}` : "";
      return `Remote branch safety could not be verified, so the remote branch will be kept.${detail}`;
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

  async analyzeLocalAgainstPrHead(
    repoInfo: RepoInfo,
    identity: BranchIdentity,
    prHeadSha: string,
  ): Promise<BranchSyncDiagnostic> {
    const localRef = identity.localHead;
    if (!localRef) {
      return {
        state: "unknown",
        localOnly: 0,
        remoteOnly: 0,
        remoteRef: prHeadSha,
        reason: "Local source branch is not safely mapped in this workspace.",
      };
    }

    try {
      const counts = await this.git.revListLeftRightCount(
        repoInfo,
        localRef,
        prHeadSha,
      );
      const state = classifyBranchSync(counts.localOnly, counts.remoteOnly);
      debug(
        `[branch-sync] post-merge local repo=${repoInfo.label} local=${localRef} prHead=${prHeadSha} state=${state} localOnly=${counts.localOnly} prHeadOnly=${counts.remoteOnly}`,
      );
      return {
        state,
        ...counts,
        localRef,
        remoteRef: prHeadSha,
        remoteMatchesPrHead: true,
      };
    } catch (error) {
      warn(
        `[branch-sync] post-merge local analysis failed repo=${repoInfo.label} local=${localRef} prHead=${prHeadSha}: ${(error as Error).message}`,
      );
      return {
        state: "unknown",
        localOnly: 0,
        remoteOnly: 0,
        localRef,
        remoteRef: prHeadSha,
        reason: (error as Error).message,
      };
    }
  }

  async analyzeRemoteAgainstPrHead(
    repoInfo: RepoInfo,
    identity: BranchIdentity,
    prHeadSha: string,
  ): Promise<RemoteHeadDiagnostic> {
    const remoteRef = identity.remoteHead?.refName;
    if (!remoteRef) {
      return {
        state: "absent",
        remoteOnly: 0,
        prHeadOnly: 0,
      };
    }

    try {
      const remoteSha = await this.git.resolveRef(repoInfo, remoteRef);
      if (remoteSha === prHeadSha) {
        return {
          state: "in-sync",
          remoteOnly: 0,
          prHeadOnly: 0,
          remoteRef,
        };
      }

      const counts = await this.git.revListLeftRightCount(
        repoInfo,
        remoteRef,
        prHeadSha,
      );
      const state = classifyRemoteHead(counts.localOnly, counts.remoteOnly);
      debug(
        `[branch-sync] post-merge remote repo=${repoInfo.label} remote=${remoteRef} prHead=${prHeadSha} state=${state} remoteOnly=${counts.localOnly} prHeadOnly=${counts.remoteOnly}`,
      );
      return {
        state,
        remoteOnly: counts.localOnly,
        prHeadOnly: counts.remoteOnly,
        remoteRef,
      };
    } catch (error) {
      warn(
        `[branch-sync] post-merge remote analysis failed repo=${repoInfo.label} remote=${remoteRef} prHead=${prHeadSha}: ${(error as Error).message}`,
      );
      return {
        state: "unknown",
        remoteOnly: 0,
        prHeadOnly: 0,
        remoteRef,
        reason: (error as Error).message,
      };
    }
  }

  async analyzePostMergeCleanup(
    repoInfo: RepoInfo,
    identity: BranchIdentity,
    prHeadSha: string,
  ): Promise<PostMergeBranchSafetyDiagnostic> {
    const [local, remote] = await Promise.all([
      identity.localHead
        ? this.analyzeLocalAgainstPrHead(repoInfo, identity, prHeadSha)
        : Promise.resolve(undefined),
      this.analyzeRemoteAgainstPrHead(repoInfo, identity, prHeadSha),
    ]);
    return { local, remote };
  }
}
