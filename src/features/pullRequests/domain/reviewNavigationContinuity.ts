import type {
  ReviewNavigationCandidate,
  ReviewNavigationModel,
} from "./reviewNavigationModel";

export interface ReviewSubmissionContinuity {
  item: ReviewNavigationCandidate;
  knownConversationRootIds: ReadonlySet<number>;
}

/**
 * Resolve the logical item that succeeds an active pending operation after the
 * server has persisted it and the authoritative conversation snapshot has been
 * refreshed.
 *
 * Replies and lifecycle actions retain their conversation root identity. A new
 * inline comment has no server root id yet, so it may only be followed when one
 * and only one new unresolved conversation appears at the exact same canonical
 * anchor. Ambiguous anchors deliberately return undefined rather than guessing.
 */
export function findReviewSubmissionSuccessor(
  continuity: ReviewSubmissionContinuity,
  model: ReviewNavigationModel,
): ReviewNavigationCandidate | undefined {
  const item = continuity.item;

  if (item.rootCommentId !== undefined) {
    return model.unresolved.find(
      (candidate) =>
        candidate.kind === "conversation" &&
        candidate.rootCommentId === item.rootCommentId,
    );
  }

  if (
    item.kind !== "inline-comment" ||
    !item.path ||
    item.side === undefined ||
    item.line === undefined ||
    item.line <= 0
  ) {
    return undefined;
  }

  const candidates = model.unresolved.filter(
    (candidate) =>
      candidate.kind === "conversation" &&
      candidate.rootCommentId !== undefined &&
      !continuity.knownConversationRootIds.has(candidate.rootCommentId) &&
      candidate.placeable &&
      candidate.path === item.path &&
      candidate.side === item.side &&
      candidate.line === item.line,
  );

  return candidates.length === 1 ? candidates[0] : undefined;
}
