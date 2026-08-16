import * as vscode from "vscode";
import type { RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";

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

interface GitRepositoryLike {
  rootUri: vscode.Uri;
  fetch(options: { remote?: string; ref?: string }): Promise<void>;
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
  if (!ref?.upstream?.name) return false;
  const upstream = ref.upstream;
  if (upstream.name === branch) return true;
  if (upstream.remote && upstream.name === `${upstream.remote}/${branch}`) return true;
  return upstream.name.endsWith(`/${branch}`);
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

export function resolveBranchIdentity(
  refs: BranchRefSnapshot[],
  head: BranchRefSnapshot | undefined,
  prHead: string,
  base: string,
): BranchIdentity {
  const currentBranch = head?.name;

  // A local branch may have a different name from the PR head. Prefer the
  // checked-out branch when its upstream tracks the PR head; only then fall
  // back to an exact local-name match.
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

export class BranchCleanupService {
  async discover(
    repoInfo: RepoInfo,
    prHead: string,
    base: string,
  ): Promise<BranchIdentity> {
    const repository = await this.gitRepository(repoInfo);
    if (!repository) {
      log(`[branch-cleanup] repository unavailable repo=${repoInfo.label}`);
      return {
        prHead,
        base,
        localHeadCheckedOut: false,
      };
    }

    try {
      await repository.fetch({ remote: "origin" });
    } catch (error) {
      log(`[branch-cleanup] fetch best-effort failed repo=${repoInfo.label}: ${(error as Error).message}`);
    }

    const identity = resolveBranchIdentity(
      repository.state.refs,
      repository.state.HEAD,
      prHead,
      base,
    );
    log(
      `[branch-cleanup] discovered repo=${repoInfo.label} prHead=${prHead} localHead=${identity.localHead ?? "none"} remoteHead=${identity.remoteHead?.refName ?? "none"} base=${base} localBase=${identity.localBase ?? "none"} remoteBase=${identity.remoteBase?.refName ?? "none"} current=${identity.currentBranch ?? "detached"}`,
    );
    return identity;
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
      log(`[branch-cleanup] git repository lookup failed repo=${repoInfo.label}: ${(error as Error).message}`);
      return undefined;
    }
  }
}
