import * as vscode from "vscode";
import type { RepoInfo } from "../../../context/repoManager";
import {
  emptyPendingReviewSession,
  queueConversationAction,
  reconcilePendingReviewSubmission,
  type PendingConversationAction,
  type PendingInlineComment,
  type PendingReviewReply,
  type PendingReviewSession,
  type PendingReviewSubmissionResult,
} from "../domain/pendingReviewSession";

export interface PullRequestReviewSessionChange {
  key: string;
  repositoryKey: string;
  pullRequestNumber: number;
  session: PendingReviewSession;
}

/**
 * Extension-owned source of truth for pending pull-request review operations.
 *
 * Webviews and native editor projections may cache a snapshot for rendering, but
 * must mutate pending review state through this service rather than maintaining
 * independent sessions. State intentionally lives for the extension-host
 * lifetime only; durable cross-restart persistence is not part of this model.
 */
export class PullRequestReviewSessionService implements vscode.Disposable {
  private readonly sessions = new Map<string, PendingReviewSession>();
  private readonly changeEmitter =
    new vscode.EventEmitter<PullRequestReviewSessionChange>();

  readonly onDidChange = this.changeEmitter.event;

  get(repoInfo: Pick<RepoInfo, "key">, pullRequestNumber: number): PendingReviewSession {
    return cloneSession(
      this.sessions.get(reviewSessionKey(repoInfo.key, pullRequestNumber)) ??
        emptyPendingReviewSession(),
    );
  }

  replace(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
    session: PendingReviewSession,
  ): PendingReviewSession {
    return this.store(repoInfo.key, pullRequestNumber, normalizeSession(session));
  }

  queueInlineComment(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
    comment: PendingInlineComment,
  ): PendingReviewSession {
    const current = this.get(repoInfo, pullRequestNumber);
    return this.store(repoInfo.key, pullRequestNumber, {
      ...current,
      inlineComments: [
        ...current.inlineComments.filter((item) => item.id !== comment.id),
        cloneInlineComment(comment),
      ],
    });
  }

  queueReply(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
    reply: PendingReviewReply,
  ): PendingReviewSession {
    const current = this.get(repoInfo, pullRequestNumber);
    return this.store(repoInfo.key, pullRequestNumber, {
      ...current,
      replies: [
        ...current.replies.filter((item) => item.id !== reply.id),
        cloneReply(reply),
      ],
    });
  }

  queueConversationAction(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
    action: PendingConversationAction,
  ): PendingReviewSession {
    const current = this.get(repoInfo, pullRequestNumber);
    return this.store(
      repoInfo.key,
      pullRequestNumber,
      queueConversationAction(current, cloneConversationAction(action)),
    );
  }

  remove(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
    pendingId: string,
  ): PendingReviewSession {
    const current = this.get(repoInfo, pullRequestNumber);
    return this.store(repoInfo.key, pullRequestNumber, {
      inlineComments: current.inlineComments.filter((item) => item.id !== pendingId),
      replies: current.replies.filter((item) => item.id !== pendingId),
      conversationActions: current.conversationActions.filter(
        (item) => item.id !== pendingId,
      ),
    });
  }

  reconcile(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
    result: PendingReviewSubmissionResult,
  ): PendingReviewSession {
    const current = this.get(repoInfo, pullRequestNumber);
    return this.store(
      repoInfo.key,
      pullRequestNumber,
      reconcilePendingReviewSubmission(current, result),
    );
  }

  clear(
    repoInfo: Pick<RepoInfo, "key">,
    pullRequestNumber: number,
  ): PendingReviewSession {
    return this.store(
      repoInfo.key,
      pullRequestNumber,
      emptyPendingReviewSession(),
    );
  }

  clearRepository(repositoryKey: string): void {
    for (const key of [...this.sessions.keys()]) {
      if (key.startsWith(`${repositoryKey}::pr:`)) {
        this.sessions.delete(key);
      }
    }
  }

  dispose(): void {
    this.sessions.clear();
    this.changeEmitter.dispose();
  }

  private store(
    repositoryKey: string,
    pullRequestNumber: number,
    session: PendingReviewSession,
  ): PendingReviewSession {
    const normalized = normalizeSession(session);
    const key = reviewSessionKey(repositoryKey, pullRequestNumber);
    if (isEmpty(normalized)) this.sessions.delete(key);
    else this.sessions.set(key, normalized);

    const snapshot = cloneSession(normalized);
    this.changeEmitter.fire({
      key,
      repositoryKey,
      pullRequestNumber,
      session: snapshot,
    });
    return cloneSession(snapshot);
  }
}

export function reviewSessionKey(
  repositoryKey: string,
  pullRequestNumber: number,
): string {
  return `${repositoryKey}::pr:${pullRequestNumber}`;
}

function normalizeSession(session: PendingReviewSession): PendingReviewSession {
  return {
    inlineComments: Array.isArray(session?.inlineComments)
      ? session.inlineComments.map(cloneInlineComment)
      : [],
    replies: Array.isArray(session?.replies)
      ? session.replies.map(cloneReply)
      : [],
    conversationActions: Array.isArray(session?.conversationActions)
      ? session.conversationActions.map(cloneConversationAction)
      : [],
  };
}

function cloneSession(session: PendingReviewSession): PendingReviewSession {
  return normalizeSession(session);
}

function cloneInlineComment(item: PendingInlineComment): PendingInlineComment {
  return {
    id: item.id,
    path: item.path,
    new_position: item.new_position,
    old_position: item.old_position,
    body: item.body,
  };
}

function cloneReply(item: PendingReviewReply): PendingReviewReply {
  return {
    id: item.id,
    rootCommentId: item.rootCommentId,
    body: item.body,
  };
}

function cloneConversationAction(
  item: PendingConversationAction,
): PendingConversationAction {
  return {
    id: item.id,
    rootCommentId: item.rootCommentId,
    action: item.action,
  };
}

function isEmpty(session: PendingReviewSession): boolean {
  return (
    session.inlineComments.length === 0 &&
    session.replies.length === 0 &&
    session.conversationActions.length === 0
  );
}