import type { PendingReviewSession } from "./pendingReviewSession";
import { resolveReviewConversationPlacement } from "./reviewConversationPlacement";
import type { ReviewConversation } from "./reviewConversationModel";

export interface ReviewNavigationCandidate {
  rootCommentId: number;
  path: string;
  side: "base" | "head";
  line: number;
}

export interface ReviewNavigationModel {
  unresolvedByPath: Map<string, number>;
  placedUnresolved: ReviewNavigationCandidate[];
}

export function buildReviewNavigationModel(
  conversations: ReviewConversation[],
  pending: PendingReviewSession,
): ReviewNavigationModel {
  const unresolvedByPath = new Map<string, number>();
  const placedUnresolved: ReviewNavigationCandidate[] = [];

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
    if (placement.kind !== "placed") continue;
    placedUnresolved.push({
      rootCommentId: conversation.root.id,
      path: placement.path,
      side: placement.side,
      line: placement.line,
    });
  }

  placedUnresolved.sort((left, right) =>
    left.path.localeCompare(right.path) ||
    sideOrder(left.side) - sideOrder(right.side) ||
    left.line - right.line ||
    left.rootCommentId - right.rootCommentId,
  );

  return { unresolvedByPath, placedUnresolved };
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

function sideOrder(side: "base" | "head"): number {
  return side === "base" ? 0 : 1;
}
