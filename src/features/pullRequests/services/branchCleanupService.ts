import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import type { RepoInfo } from "../../../context/repoManager";
import { debug, info, warn } from "../../../debug/outputChannel";

const execFileAsync = promisify(execFile);

export interface BranchRefSnapshot {
  name?: string;
  remote?: string;
  upstream?: {
    name?: string;
    remote?: string;
  };
}

export interface BranchIdentity {
  prHead: string;
  base: string;
  localHead?: string;
  localHeadCheckedOut: boolean;
  remoteHead?: {
    remote: string;
    branch: string;
    refName: string;
  };
  localBase?: string;
  remoteBase?: {
    remote: string;
    branch: string;
    refName: string;
  };
  currentBranch?: string;
}

export interface BranchCleanupPlan {
  localBranch?: string;
  remoteBranch?: {
    remote: string;
    branch: string;
  };
  checkoutBaseRequired: boolean;
  checkoutBase: string;
  canDeleteLocal: boolean;
  canDeleteRemote: boolean;
}

export interface BranchCleanupSelection {
  deleteLocal: boolean;
  deleteRemote: boolean;
}

export interface BranchCleanupResult {
  checkedOutBase: boolean;
  localDeleted: boolean;
  remoteDeleted: boolean;
  errors: string[];
}

export interface BranchCleanupOperations {
  checkoutBase(branch: string): Promise<void>;
  deleteLocal(branch: string): Promise<void>;
  deleteRemote(remote: string, branch: string): Promise<void>;
}

interface GitRepositoryLike {
  rootUri: vscode.Uri;
  fetch(options: { remote?: string; ref?: string }): Promise<void>;
  checkout(
    treeish: string,
    options?: { createNewBranch?: boolean; newBranchName?: string },
  ): Promise<void>;
  state: {
    HEAD?: BranchRefSnapshot;
    refs: BranchRefSnapshot[];
  };
}

interface GitExtensionExportsLike {
  getAPI(version: number): { repositories: GitRepositoryLike[] };
}

function remoteBranchName(ref: BranchRefSnapshot): string | undefined {
  if (!ref.remote || !ref.name) return undefined;
  const prefix = `${ref.remote}/`;
  return ref.name.startsWith(prefix) ? ref.name.slice(prefix.length) : ref.name;
}

function tracksBranch(ref: BranchRefSnapshot | undefined, branch: string): boolean {
  const upstreamName = ref?.upstream?.name;
  if (!upstreamName) return false;
  const upstreamRemote = ref?.upstream?.remote;
  if (upstreamName === branch) return true;
  if (upstreamRemote && upstreamName === `${upstreamRemote}/${branch}`) return true;
  return upstreamName.endsWith(`/${branch}`);
}

function pickRemote(
  refs: BranchRefSnapshot[],
  branch: string,
): BranchIdentity["remoteHead"] {
  const candidates = refs
    .filter((ref) => ref.remote && remoteBranchName(ref) === branch)
    .sort((a, b) => (a.remote === "origin" ? -1 : b.remote === "origin" ? 1 : 0));
  const match = candidates[0];
  if (!match?.remote || !match.name) return undefined;
  return {
    remote: match.remote,
    branch,
    refName: match.name,
  };
}

export function parseGitBranchRefs(output: string): BranchRefSnapshot[] {
  const refs: BranchRefSnapshot[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("refs/heads/")) {
      const name = line.slice("refs/heads/".length);
      if (name) refs.push({ name });
      continue;
    }

    if (line.startsWith("refs/remotes/")) {
      const shortName = line.slice("refs/remotes/".length);
      const separator = shortName.indexOf("/");
      if (separator <= 0) continue;

      const remote = shortName.slice(0, separator);
      const branch = shortName.slice(separator + 1);
      if (!branch || branch === "HEAD") continue;
      refs.push({
        name: `${remote}/${branch}`,
        remote,
      });
    }
  }

  return refs;
}

export function resolveBranchIdentity(
  refs: BranchRefSnapshot[],
  head: BranchRefSnapshot | undefined,
  prHead: string,
  base: string,
): BranchIdentity {
  const currentBranch = head?.name;

  const trackedLocalHead = tracksBranch(head, prHead) ? head?.name : undefined;
  const exactLocalHead = refs.find((ref) => !ref.remote && ref.name === prHead)?.name;
  const localHead = trackedLocalHead ?? exactLocalHead;

  const trackedLocalBase = tracksBranch(head, base) ? head?.name : undefined;
  const exactLocalBase = refs.find((ref) => !ref.remote && ref.name === base)?.name;
  const localBase = trackedLocalBase ?? exactLocalBase;

  return {
    prHead,
    base,
    localHead,
    localHeadCheckedOut: !!localHead && currentBranch === localHead,
    remoteHead: pickRemote(refs, prHead),
    localBase,
    remoteBase: pickRemote(refs, base),
    currentBranch,
  };
}

export function planBranchCleanup(identity: BranchIdentity): BranchCleanupPlan {
  return {
    localBranch: identity.localHead,
    remoteBranch: identity.remoteHead
      ? {
          remote: identity.remoteHead.remote,
          branch: identity.remoteHead.branch,
        }
      : undefined,
    checkoutBaseRequired: !!identity.localHead && identity.localHeadCheckedOut,
    checkoutBase: identity.localBase ?? identity.base,
    canDeleteLocal: !!identity.localHead,
    canDeleteRemote: !!identity.remoteHead,
  };
}

export async function executeBranchCleanupPlan(
  plan: BranchCleanupPlan,
  selection: BranchCleanupSelection,
  operations: BranchCleanupOperations,
): Promise<BranchCleanupResult> {
  const result: BranchCleanupResult = {
    checkedOutBase: false,
    localDeleted: false,
    remoteDeleted: false,
    errors: [],
  };

  let localDeletionAllowed = selection.deleteLocal && plan.canDeleteLocal && !!plan.localBranch;

  if (localDeletionAllowed && plan.checkoutBaseRequired) {
    try {
      await operations.checkoutBase(plan.checkoutBase);
      result.checkedOutBase = true;
    } catch (error) {
      result.errors.push(`Unable to checkout base branch '${plan.checkoutBase}': ${(error as Error).message}`);
      localDeletionAllowed = false;
    }
  }

  if (localDeletionAllowed && plan.localBranch) {
    try {
      await operations.deleteLocal(plan.localBranch);
      result.localDeleted = true;
    } catch (error) {
      result.errors.push(`Unable to delete local branch '${plan.localBranch}': ${(error as Error).message}`);
    }
  }

  if (selection.deleteRemote && plan.canDeleteRemote && plan.remoteBranch) {
    try {
      await operations.deleteRemote(plan.remoteBranch.remote, plan.remoteBranch.branch);
      result.remoteDeleted = true;
    } catch (error) {
      result.errors.push(
        `Unable to delete remote branch '${plan.remoteBranch.remote}/${plan.remoteBranch.branch}': ${(error as Error).message}`,
      );
    }
  }

  return result;
}

export class BranchCleanupService {
  async discover(
    repoInfo: RepoInfo,
    prHead: string,
    base: string,
  ): Promise<BranchIdentity> {
    const repository = await this.gitRepository(repoInfo);
    if (!repository) {
      warn(`[branch-cleanup] repository unavailable repo=${repoInfo.label}`);
      return {
        prHead,
        base,
        localHeadCheckedOut: false,
      };
    }

    try {
      await repository.fetch({ remote: "origin" });
    } catch (error) {
      warn(`[branch-cleanup] fetch best-effort failed repo=${repoInfo.label}: ${(error as Error).message}`);
    }

    let refs = repository.state.refs;
    try {
      refs = await this.branchRefs(repoInfo);
      debug(`[branch-cleanup] git refs loaded repo=${repoInfo.label} count=${refs.length}`);
    } catch (error) {
      warn(`[branch-cleanup] git refs fallback repo=${repoInfo.label}: ${(error as Error).message}`);
    }

    const identity = resolveBranchIdentity(
      refs,
      repository.state.HEAD,
      prHead,
      base,
    );
    debug(
      `[branch-cleanup] discovered repo=${repoInfo.label} prHead=${prHead} localHead=${identity.localHead ?? "none"} remoteHead=${identity.remoteHead?.refName ?? "none"} base=${base} localBase=${identity.localBase ?? "none"} remoteBase=${identity.remoteBase?.refName ?? "none"} current=${identity.currentBranch ?? "detached"}`,
    );
    return identity;
  }

  async checkoutBase(repoInfo: RepoInfo, identity: BranchIdentity): Promise<void> {
    const repository = await this.requireGitRepository(repoInfo);
    const branch = identity.localBase ?? identity.base;
    try {
      await repository.checkout(branch);
    } catch (localError) {
      const remoteBase = identity.remoteBase;
      if (!remoteBase) throw localError;
      await repository.checkout(remoteBase.refName, {
        createNewBranch: true,
        newBranchName: identity.base,
      });
    }
    info(`[branch-cleanup] checked out base repo=${repoInfo.label} branch=${identity.base}`);
  }

  async cleanup(
    repoInfo: RepoInfo,
    identity: BranchIdentity,
    selection: BranchCleanupSelection,
  ): Promise<BranchCleanupResult> {
    const plan = planBranchCleanup(identity);
    const result = await executeBranchCleanupPlan(plan, selection, {
      checkoutBase: async () => this.checkoutBase(repoInfo, identity),
      deleteLocal: async (branch) => {
        await this.git(repoInfo, ["branch", "-D", "--", branch]);
        info(`[branch-cleanup] deleted local branch repo=${repoInfo.label} branch=${branch}`);
      },
      deleteRemote: async (remote, branch) => {
        await this.git(repoInfo, ["push", remote, "--delete", branch]);
        info(`[branch-cleanup] deleted remote branch repo=${repoInfo.label} branch=${remote}/${branch}`);
      },
    });

    if (result.errors.length > 0) {
      warn(`[branch-cleanup] cleanup partial failure repo=${repoInfo.label} errors=${result.errors.join(" | ")}`);
    } else {
      info(
        `[branch-cleanup] cleanup complete repo=${repoInfo.label} local=${result.localDeleted} remote=${result.remoteDeleted} checkout=${result.checkedOutBase}`,
      );
    }
    return result;
  }

  private async branchRefs(repoInfo: RepoInfo): Promise<BranchRefSnapshot[]> {
    const { stdout } = await execFileAsync(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
      { cwd: repoInfo.rootPath, encoding: "utf8" },
    );
    return parseGitBranchRefs(String(stdout));
  }

  private async git(repoInfo: RepoInfo, args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd: repoInfo.rootPath });
  }

  private async requireGitRepository(repoInfo: RepoInfo): Promise<GitRepositoryLike> {
    const repository = await this.gitRepository(repoInfo);
    if (!repository) {
      throw new Error(`No git repository found for ${repoInfo.label}.`);
    }
    return repository;
  }

  private async gitRepository(repoInfo: RepoInfo): Promise<GitRepositoryLike | undefined> {
    const gitExt = vscode.extensions.getExtension<GitExtensionExportsLike>("vscode.git");
    if (!gitExt) return undefined;
    try {
      const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
      return git
        .getAPI(1)
        .repositories.find((repo) => repo.rootUri.fsPath === repoInfo.rootPath);
    } catch (error) {
      warn(`[branch-cleanup] git repository lookup failed repo=${repoInfo.label}: ${(error as Error).message}`);
      return undefined;
    }
  }
}
