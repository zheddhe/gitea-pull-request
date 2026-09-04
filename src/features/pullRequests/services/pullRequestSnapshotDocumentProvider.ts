import * as vscode from "vscode";
import type { GiteaPullRequest } from "../../../api/types";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";

export const PULL_REQUEST_SNAPSHOT_SCHEME = "gitea-pr";

export type PullRequestSnapshotSide = "base" | "head";

export interface PullRequestSnapshotDocumentIdentity {
  repositoryKey: string;
  repositoryFullName: string;
  pullRequestNumber: number;
  side: PullRequestSnapshotSide;
  sha: string;
  path: string;
}

export function createPullRequestSnapshotDocumentIdentity(
  repoInfo: RepoInfo,
  pr: GiteaPullRequest,
  side: PullRequestSnapshotSide,
  filePath: string,
): PullRequestSnapshotDocumentIdentity {
  const ref = side === "base" ? pr.base : pr.head;
  return {
    repositoryKey: repoInfo.key,
    repositoryFullName: ref.repo.full_name,
    pullRequestNumber: pr.number,
    side,
    sha: ref.sha,
    path: filePath,
  };
}

export function createPullRequestSnapshotUri(
  identity: PullRequestSnapshotDocumentIdentity,
): vscode.Uri {
  const query = new URLSearchParams({
    repositoryKey: identity.repositoryKey,
    repositoryFullName: identity.repositoryFullName,
    pullRequestNumber: String(identity.pullRequestNumber),
    sha: identity.sha,
    path: identity.path,
  });

  return vscode.Uri.from({
    scheme: PULL_REQUEST_SNAPSHOT_SCHEME,
    authority: "snapshot",
    path: `/${identity.side}/${identity.path}`,
    query: query.toString(),
  });
}

export function parsePullRequestSnapshotUri(
  uri: vscode.Uri,
): PullRequestSnapshotDocumentIdentity | undefined {
  if (uri.scheme !== PULL_REQUEST_SNAPSHOT_SCHEME) return undefined;

  const params = new URLSearchParams(uri.query);
  const repositoryKey = params.get("repositoryKey")?.trim();
  const repositoryFullName = params.get("repositoryFullName")?.trim();
  const pullRequestNumber = Number(params.get("pullRequestNumber"));
  const sha = params.get("sha")?.trim();
  const filePath = params.get("path");
  const side = uri.path.startsWith("/base/")
    ? "base"
    : uri.path.startsWith("/head/")
      ? "head"
      : undefined;

  if (
    !repositoryKey ||
    !repositoryFullName ||
    !Number.isInteger(pullRequestNumber) ||
    pullRequestNumber <= 0 ||
    !side ||
    !sha ||
    !filePath
  ) {
    return undefined;
  }

  return {
    repositoryKey,
    repositoryFullName,
    pullRequestNumber,
    side,
    sha,
    path: filePath,
  };
}

export class PullRequestSnapshotDocumentProvider
  implements vscode.TextDocumentContentProvider
{
  constructor(
    private readonly api: Pick<GiteaApiClient, "getFileContents">,
    private readonly repoManager: Pick<RepoManager, "getRepos">,
  ) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const identity = parsePullRequestSnapshotUri(uri);
    if (!identity) {
      throw new Error(`Invalid pull request snapshot URI: ${uri.toString()}`);
    }

    const contextRepo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === identity.repositoryKey);
    if (!contextRepo) {
      throw new Error(
        `Repository context unavailable for PR #${identity.pullRequestNumber}.`,
      );
    }

    const contentRepo = repositoryForSnapshot(
      contextRepo,
      identity.repositoryFullName,
    );

    try {
      return await this.api.getFileContents(
        contentRepo,
        identity.sha,
        identity.path,
      );
    } catch (error) {
      if (isMissingSnapshotFile(error)) return "";
      throw error;
    }
  }
}

function repositoryForSnapshot(
  contextRepo: RepoInfo,
  repositoryFullName: string,
): RepoInfo {
  const slash = repositoryFullName.indexOf("/");
  if (slash <= 0 || slash === repositoryFullName.length - 1) {
    throw new Error(`Invalid repository full name: ${repositoryFullName}`);
  }

  const owner = repositoryFullName.slice(0, slash);
  const repo = repositoryFullName.slice(slash + 1);
  return {
    ...contextRepo,
    owner,
    repo,
    label: repositoryFullName,
    key: `${contextRepo.serverUrl}|${repositoryFullName}`,
  };
}

function isMissingSnapshotFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|file not found/i.test(message);
}
