import { execFile } from "child_process";
import { promisify } from "util";
import type { GiteaPullRequest } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";

const execFileAsync = promisify(execFile);

export type ConflictResolutionPreparationResult =
  | {
      kind: "clean";
      sourceBranch: string;
      baseRef: string;
    }
  | {
      kind: "conflicts";
      sourceBranch: string;
      baseRef: string;
      conflictedFiles: string[];
    };

export interface ConflictResolutionInspection {
  dirty: boolean;
  mergeInProgress: boolean;
  currentBranch?: string;
}

export interface ConflictResolutionPlan {
  sourceBranch: string;
  sourceSha: string;
  sourceRemote: string;
  sourceRemoteRef: string;
  baseBranch: string;
  baseRemote: string;
  baseRemoteRef: string;
}

export interface ConflictResolutionOperations {
  inspect(): Promise<ConflictResolutionInspection>;
  fetch(remote: string): Promise<void>;
  checkoutSource(plan: ConflictResolutionPlan): Promise<void>;
  mergeBase(plan: ConflictResolutionPlan): Promise<ConflictResolutionPreparationResult>;
  abortMerge(): Promise<void>;
}

export type SourceSynchronization = "current" | "fastForward" | "diverged";

export function classifySourceSynchronization(
  localSha: string,
  remoteSha: string,
  localIsAncestorOfRemote: boolean,
): SourceSynchronization {
  if (localSha === remoteSha) return "current";
  return localIsAncestorOfRemote ? "fastForward" : "diverged";
}

export async function executeConflictResolutionPreparation(
  plan: ConflictResolutionPlan,
  operations: ConflictResolutionOperations,
): Promise<ConflictResolutionPreparationResult> {
  const inspection = await operations.inspect();
  if (inspection.mergeInProgress) {
    throw new Error(
      "A Git merge is already in progress. Resolve it or abort it before preparing this pull request.",
    );
  }
  if (inspection.dirty) {
    throw new Error(
      "The working tree contains local changes. Commit, stash, or discard them before preparing conflict resolution.",
    );
  }

  const remotes = new Set([plan.sourceRemote, plan.baseRemote]);
  for (const remote of remotes) {
    await operations.fetch(remote);
  }

  await operations.checkoutSource(plan);
  return operations.mergeBase(plan);
}

export class ConflictResolutionService {
  async prepare(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
  ): Promise<ConflictResolutionPreparationResult> {
    const plan = await this.plan(repoInfo, pullRequest);
    log(
      `[conflict-resolution] prepare repo=${repoInfo.label} pr=#${pullRequest.number} source=${plan.sourceRemoteRef}@${plan.sourceSha.slice(0, 8)} base=${plan.baseRemoteRef}`,
    );

    const result = await executeConflictResolutionPreparation(plan, {
      inspect: () => this.inspect(repoInfo),
      fetch: async (remote) => {
        await this.git(repoInfo, ["fetch", "--prune", remote]);
        log(`[conflict-resolution] fetched repo=${repoInfo.label} remote=${remote}`);
      },
      checkoutSource: (resolvedPlan) => this.checkoutSource(repoInfo, resolvedPlan),
      mergeBase: (resolvedPlan) => this.mergeBase(repoInfo, resolvedPlan),
      abortMerge: () => this.abort(repoInfo),
    });

    log(
      `[conflict-resolution] prepared repo=${repoInfo.label} pr=#${pullRequest.number} result=${result.kind}`,
    );
    return result;
  }

  async inspect(repoInfo: RepoInfo): Promise<ConflictResolutionInspection> {
    const [{ stdout: status }, { stdout: branch }, mergeHead] = await Promise.all([
      this.git(repoInfo, ["status", "--porcelain", "--untracked-files=normal"]),
      this.git(repoInfo, ["branch", "--show-current"]),
      this.gitOptional(repoInfo, ["rev-parse", "--verify", "MERGE_HEAD"]),
    ]);

    const currentBranch = String(branch).trim() || undefined;
    return {
      dirty: String(status).trim().length > 0,
      mergeInProgress: mergeHead !== undefined,
      currentBranch,
    };
  }

  async abort(repoInfo: RepoInfo): Promise<void> {
    const inspection = await this.inspect(repoInfo);
    if (!inspection.mergeInProgress) {
      throw new Error("No Git merge is currently in progress.");
    }
    await this.git(repoInfo, ["merge", "--abort"]);
    log(`[conflict-resolution] aborted repo=${repoInfo.label}`);
  }

  private async plan(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
  ): Promise<ConflictResolutionPlan> {
    const remotes = await this.remotes(repoInfo);
    const baseRepository = pullRequest.base.repo.full_name;
    const sourceRepository = pullRequest.head.repo.full_name;

    const baseRemote = this.remoteForRepository(remotes, baseRepository, repoInfo.label);
    if (!baseRemote) {
      throw new Error(
        `No local Git remote matches the pull request base repository '${baseRepository}'.`,
      );
    }

    const sourceRemote = this.remoteForRepository(
      remotes,
      sourceRepository,
      repoInfo.label,
    );
    if (!sourceRemote) {
      throw new Error(
        `No local Git remote matches the pull request source repository '${sourceRepository}'. Add a remote for the fork before preparing conflict resolution.`,
      );
    }

    return {
      sourceBranch: pullRequest.head.ref,
      sourceSha: pullRequest.head.sha,
      sourceRemote,
      sourceRemoteRef: `${sourceRemote}/${pullRequest.head.ref}`,
      baseBranch: pullRequest.base.ref,
      baseRemote,
      baseRemoteRef: `${baseRemote}/${pullRequest.base.ref}`,
    };
  }

  private async checkoutSource(
    repoInfo: RepoInfo,
    plan: ConflictResolutionPlan,
  ): Promise<void> {
    const remoteSha = String(
      (await this.git(repoInfo, ["rev-parse", plan.sourceRemoteRef])).stdout,
    ).trim();
    if (remoteSha !== plan.sourceSha) {
      throw new Error(
        `The fetched source branch '${plan.sourceRemoteRef}' moved from the pull request head (${plan.sourceSha.slice(0, 8)} -> ${remoteSha.slice(0, 8)}). Refresh the pull request before preparing conflict resolution.`,
      );
    }

    const localExists =
      (await this.gitOptional(repoInfo, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${plan.sourceBranch}`,
      ])) !== undefined;

    if (localExists) {
      await this.git(repoInfo, ["checkout", plan.sourceBranch]);
    } else {
      await this.git(repoInfo, [
        "checkout",
        "-b",
        plan.sourceBranch,
        "--track",
        plan.sourceRemoteRef,
      ]);
    }

    const checkedOut = String(
      (await this.git(repoInfo, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout,
    ).trim();
    if (checkedOut !== plan.sourceBranch) {
      throw new Error(
        `Expected source branch '${plan.sourceBranch}' to be checked out, but Git reports '${checkedOut || "detached HEAD"}'.`,
      );
    }

    const localSha = String(
      (await this.git(repoInfo, ["rev-parse", "HEAD"])).stdout,
    ).trim();
    const localIsAncestorOfRemote =
      localSha === remoteSha ||
      (await this.gitOptional(repoInfo, [
        "merge-base",
        "--is-ancestor",
        localSha,
        plan.sourceRemoteRef,
      ])) !== undefined;
    const synchronization = classifySourceSynchronization(
      localSha,
      remoteSha,
      localIsAncestorOfRemote,
    );

    if (synchronization === "diverged") {
      throw new Error(
        `Local source branch '${plan.sourceBranch}' has commits that are not part of the pull request head. Reconcile or preserve that local work before preparing conflict resolution; the extension will not reset it.`,
      );
    }
    if (synchronization === "fastForward") {
      await this.git(repoInfo, ["merge", "--ff-only", plan.sourceRemoteRef]);
      log(
        `[conflict-resolution] fast-forwarded source repo=${repoInfo.label} branch=${plan.sourceBranch} to=${remoteSha.slice(0, 8)}`,
      );
    }

    const finalSha = String(
      (await this.git(repoInfo, ["rev-parse", "HEAD"])).stdout,
    ).trim();
    if (finalSha !== plan.sourceSha) {
      throw new Error(
        `Source branch '${plan.sourceBranch}' is not at the pull request head after synchronization. Expected ${plan.sourceSha.slice(0, 8)}, found ${finalSha.slice(0, 8)}.`,
      );
    }

    log(
      `[conflict-resolution] checked out source repo=${repoInfo.label} branch=${plan.sourceBranch} sha=${finalSha.slice(0, 8)}`,
    );
  }

  private async mergeBase(
    repoInfo: RepoInfo,
    plan: ConflictResolutionPlan,
  ): Promise<ConflictResolutionPreparationResult> {
    try {
      await this.git(repoInfo, ["merge", "--no-edit", plan.baseRemoteRef]);
      return {
        kind: "clean",
        sourceBranch: plan.sourceBranch,
        baseRef: plan.baseRemoteRef,
      };
    } catch (error) {
      const conflictedFiles = await this.conflictedFiles(repoInfo);
      const mergeHead = await this.gitOptional(repoInfo, [
        "rev-parse",
        "--verify",
        "MERGE_HEAD",
      ]);
      if (mergeHead !== undefined && conflictedFiles.length > 0) {
        return {
          kind: "conflicts",
          sourceBranch: plan.sourceBranch,
          baseRef: plan.baseRemoteRef,
          conflictedFiles,
        };
      }
      throw error;
    }
  }

  private async conflictedFiles(repoInfo: RepoInfo): Promise<string[]> {
    const result = await this.gitOptional(repoInfo, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ]);
    if (!result) return [];
    return String(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async remotes(repoInfo: RepoInfo): Promise<Map<string, string[]>> {
    const { stdout } = await this.git(repoInfo, ["remote", "-v"]);
    const remotes = new Map<string, string[]>();
    for (const line of String(stdout).split(/\r?\n/)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/);
      if (!match) continue;
      const [, name, url] = match;
      const urls = remotes.get(name) ?? [];
      if (!urls.includes(url)) urls.push(url);
      remotes.set(name, urls);
    }
    return remotes;
  }

  private remoteForRepository(
    remotes: Map<string, string[]>,
    fullName: string,
    workspaceRepository: string,
  ): string | undefined {
    const normalizedTarget = normalizeRepositoryName(fullName);
    const matches = [...remotes.entries()]
      .filter(([, urls]) =>
        urls.some((url) => normalizeRemoteRepository(url) === normalizedTarget),
      )
      .map(([name]) => name);

    if (matches.includes("origin")) return "origin";
    if (matches.length > 0) return matches[0];

    // Keep compatibility with repositories detected through SSH aliases where
    // the remote URL cannot be normalized to the Gitea API repository name.
    if (
      normalizeRepositoryName(workspaceRepository) === normalizedTarget &&
      remotes.has("origin")
    ) {
      return "origin";
    }
    return undefined;
  }

  private async git(
    repoInfo: RepoInfo,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    const result = await execFileAsync("git", args, {
      cwd: repoInfo.rootPath,
      encoding: "utf8",
    });
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  private async gitOptional(
    repoInfo: RepoInfo,
    args: string[],
  ): Promise<{ stdout: string; stderr: string } | undefined> {
    try {
      return await this.git(repoInfo, args);
    } catch {
      return undefined;
    }
  }
}

function normalizeRepositoryName(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase();
}

function normalizeRemoteRepository(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/i, "");
  const scpLike = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
  if (scpLike) return normalizeRepositoryName(scpLike[1]);

  try {
    const parsed = new URL(trimmed);
    return normalizeRepositoryName(parsed.pathname);
  } catch {
    return undefined;
  }
}
