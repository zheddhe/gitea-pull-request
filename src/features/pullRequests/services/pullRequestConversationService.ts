import * as vscode from "vscode";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type {
  GiteaPullRequest,
  GiteaReviewComment,
} from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import {
  buildReviewConversations,
  type ReviewConversation,
} from "../domain/reviewConversationModel";

export interface PullRequestConversationSnapshot {
  repositoryKey: string;
  pullRequestNumber: number;
  baseSha: string;
  headSha: string;
  comments: GiteaReviewComment[];
  conversations: ReviewConversation[];
}

type ReviewCommentsApi = Pick<GiteaApiClient, "listAllPRReviewComments">;

export class PullRequestConversationService implements vscode.Disposable {
  private readonly snapshots = new Map<string, PullRequestConversationSnapshot>();
  private readonly changeEmitter = new vscode.EventEmitter<PullRequestConversationSnapshot>();

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly api: ReviewCommentsApi) {}

  get(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
  ): PullRequestConversationSnapshot | undefined {
    const snapshot = this.snapshots.get(snapshotKey(repoInfo, pullRequest));
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  async load(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
    force = false,
  ): Promise<PullRequestConversationSnapshot> {
    const key = snapshotKey(repoInfo, pullRequest);
    const cached = this.snapshots.get(key);
    if (cached && !force) return cloneSnapshot(cached);

    const comments = await this.api.listAllPRReviewComments(
      repoInfo,
      pullRequest.number,
    );
    const snapshot: PullRequestConversationSnapshot = {
      repositoryKey: repoInfo.key,
      pullRequestNumber: pullRequest.number,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      comments: [...comments],
      conversations: buildReviewConversations(comments),
    };
    this.snapshots.set(key, snapshot);
    this.changeEmitter.fire(cloneSnapshot(snapshot));
    return cloneSnapshot(snapshot);
  }

  clearRepository(repositoryKey: string): void {
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot.repositoryKey === repositoryKey) {
        this.snapshots.delete(key);
      }
    }
  }

  dispose(): void {
    this.snapshots.clear();
    this.changeEmitter.dispose();
  }
}

export function createPullRequestConversationApiView(
  api: GiteaApiClient,
  conversations: PullRequestConversationService,
  repoInfo: RepoInfo,
  pullRequest: GiteaPullRequest,
): GiteaApiClient {
  const view = Object.create(api) as GiteaApiClient;
  view.listAllPRReviewComments = async (
    requestedRepoInfo: RepoInfo,
    pullRequestNumber: number,
  ) => {
    if (
      requestedRepoInfo.key === repoInfo.key &&
      pullRequestNumber === pullRequest.number
    ) {
      return (
        await conversations.load(repoInfo, pullRequest, true)
      ).comments;
    }
    return api.listAllPRReviewComments(requestedRepoInfo, pullRequestNumber);
  };
  return view;
}

function snapshotKey(repoInfo: RepoInfo, pullRequest: GiteaPullRequest): string {
  return [
    repoInfo.key,
    pullRequest.number,
    pullRequest.base.sha,
    pullRequest.head.sha,
  ].join("::");
}

function cloneSnapshot(
  snapshot: PullRequestConversationSnapshot,
): PullRequestConversationSnapshot {
  return {
    ...snapshot,
    comments: [...snapshot.comments],
    conversations: snapshot.conversations.map((conversation) => ({
      ...conversation,
      replies: [...conversation.replies],
    })),
  };
}
