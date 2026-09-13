import type { PendingReviewSession } from "./pendingReviewSession";
import { resolveReviewConversationPlacement } from "./reviewConversationPlacement";
import type { ReviewConversation } from "./reviewConversationModel";

export type ReviewNavigationMode = "unresolved" | "pending";

export interface ReviewNavigationCandidate {
  id: string;
  kind: "conversation" | "inline-comment" | "reply" | "conversation-action";
  rootCommentId?: number;
  pendingId?: string;
  path?: string;
  side?: "base" | "head";
  line?: number;
  placeable: boolean;
}

export interface ReviewNavigationModel {
  unresolvedByPath: Map<string, number>;
  unresolved: ReviewNavigationCandidate[];
  pending: ReviewNavigationCandidate[];
  placedUnresolved: ReviewNavigationCandidate[];
  placedPending: ReviewNavigationCandidate[];
}

export function buildReviewNavigationModel(
  conversations: ReviewConversation[],
  pending: PendingReviewSession,
): ReviewNavigationModel {
  const unresolvedByPath = new Map<string, number>();
  const unresolved: ReviewNavigationCandidate[] = [];

  for (const conversation of conversations) {
    const pendingAction = pending.conversationActions.find(
      (item) => item.rootCommentId === conversation.root.id,
    );
    const resolved = pendingAction
      ? pendingAction.action === "resolve"
      : conversation.resolved;
    if (resolved) continue;

    const path = conversation.root.path?.trim();
    if (path) {
      unresolvedByPath.set(path, (unresolvedByPath.get(path) ?? 0) + 1);
    }

    const placement = resolveReviewConversationPlacement(conversation);
    unresolved.push({
      id: `conversation:${conversation.root.id}`,
      kind: "conversation",
      rootCommentId: conversation.root.id,
      ...(placement.kind === "placed"
        ? {
            path: placement.path,
            side: placement.side,
            line: placement.line,
            placeable: true as const,
          }
        : { placeable: false as const }),
    });
  }

  const conversationByRootId = new Map(
    conversations.map((conversation) => [conversation.root.id, conversation]),
  );
  const pendingTargets: ReviewNavigationCandidate[] = [
    ...pending.inlineComments.map((item) => ({
      id: `pending:${item.id}`,
      kind: "inline-comment" as const,
      pendingId: item.id,
      path: item.path,
      side: item.new_position > 0 ? ("head" as const) : ("base" as const),
      line: item.new_position > 0 ? item.new_position : item.old_position,
      placeable:
        !!item.path &&
        (item.new_position > 0 || item.old_position > 0),
    })),
    ...pending.replies.map((item) =>
      pendingConversationTarget(
        item.id,
        "reply",
        item.rootCommentId,
        conversationByRootId.get(item.rootCommentId),
      ),
    ),
    ...pending.conversationActions.map((item) =>
      pendingConversationTarget(
        item.id,
        "conversation-action",
        item.rootCommentId,
        conversationByRootId.get(item.rootCommentId),
      ),
    ),
  ];

  unresolved.sort(compareNavigationCandidates);
  pendingTargets.sort(compareNavigationCandidates);

  return {
    unresolvedByPath,
    unresolved,
    pending: pendingTargets,
    placedUnresolved: unresolved.filter((item) => item.placeable),
    placedPending: pendingTargets.filter((item) => item.placeable),
  };
}

export function nextReviewNavigationIndex(
  currentIndex: number,
  targetCount: number,
  direction: -1 | 1,
): number {
  if (targetCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= targetCount) {
    return direction > 0 ? 0 : targetCount - 1;
  }
  return (currentIndex + direction + targetCount) % targetCount;
}

function pendingConversationTarget(
  pendingId: string,
  kind: "reply" | "conversation-action",
  rootCommentId: number,
  conversation: ReviewConversation | undefined,
): ReviewNavigationCandidate {
  if (!conversation) {
    return {
      id: `pending:${pendingId}`,
      kind,
      pendingId,
      rootCommentId,
      placeable: false,
    };
  }
  const placement = resolveReviewConversationPlacement(conversation);
  return {
    id: `pending:${pendingId}`,
    kind,
    pendingId,
    rootCommentId,
    ...(placement.kind === "placed"
      ? {
          path: placement.path,
          side: placement.side,
          line: placement.line,
          placeable: true as const,
        }
      : { placeable: false as const }),
  };
}

function compareNavigationCandidates(
  left: ReviewNavigationCandidate,
  right: ReviewNavigationCandidate,
): number {
  const leftPath = left.path ?? "\uffff";
  const rightPath = right.path ?? "\uffff";
  return (
    leftPath.localeCompare(rightPath) ||
    sideOrder(left.side) - sideOrder(right.side) ||
    (left.line ?? Number.MAX_SAFE_INTEGER) -
      (right.line ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );
}

function sideOrder(side: "base" | "head" | undefined): number {
  if (side === "base") return 0;
  if (side === "head") return 1;
  return 2;
}
