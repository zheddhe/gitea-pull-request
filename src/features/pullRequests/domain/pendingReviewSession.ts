export interface PendingInlineComment {
  id: string;
  path: string;
  new_position: number;
  old_position: number;
  body: string;
}

export interface PendingReviewReply {
  id: string;
  rootCommentId: number;
  body: string;
}

export type PendingConversationActionType = "resolve" | "reopen";

export interface PendingConversationAction {
  id: string;
  rootCommentId: number;
  action: PendingConversationActionType;
}

export interface PendingReviewSession {
  inlineComments: PendingInlineComment[];
  replies: PendingReviewReply[];
  conversationActions: PendingConversationAction[];
}

export interface PendingReviewSubmissionResult {
  succeededInlineCommentIds: string[];
  succeededReplyIds: string[];
  succeededConversationActionIds: string[];
  errors: string[];
}

export function emptyPendingReviewSession(): PendingReviewSession {
  return {
    inlineComments: [],
    replies: [],
    conversationActions: [],
  };
}

export function countPendingReviewActions(session: PendingReviewSession): number {
  return (
    session.inlineComments.length +
    session.replies.length +
    session.conversationActions.length
  );
}

/**
 * A conversation can only have one desired lifecycle transition pending.
 * Queuing the same transition again cancels it; queuing the opposite transition
 * replaces the previous desired state.
 */
export function queueConversationAction(
  session: PendingReviewSession,
  action: PendingConversationAction,
): PendingReviewSession {
  const existing = session.conversationActions.find(
    (item) => item.rootCommentId === action.rootCommentId,
  );
  if (existing?.action === action.action) {
    return {
      ...session,
      conversationActions: session.conversationActions.filter(
        (item) => item.rootCommentId !== action.rootCommentId,
      ),
    };
  }
  return {
    ...session,
    conversationActions: [
      ...session.conversationActions.filter(
        (item) => item.rootCommentId !== action.rootCommentId,
      ),
      action,
    ],
  };
}

/** Remove only operations explicitly confirmed by Gitea. */
export function reconcilePendingReviewSubmission(
  session: PendingReviewSession,
  result: PendingReviewSubmissionResult,
): PendingReviewSession {
  const inlineIds = new Set(result.succeededInlineCommentIds);
  const replyIds = new Set(result.succeededReplyIds);
  const actionIds = new Set(result.succeededConversationActionIds);
  return {
    inlineComments: session.inlineComments.filter((item) => !inlineIds.has(item.id)),
    replies: session.replies.filter((item) => !replyIds.has(item.id)),
    conversationActions: session.conversationActions.filter(
      (item) => !actionIds.has(item.id),
    ),
  };
}
