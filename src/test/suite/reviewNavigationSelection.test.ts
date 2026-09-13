import * as assert from "assert";
import type {
  ReviewNavigationCandidate,
  ReviewNavigationModel,
} from "../../features/pullRequests/domain/reviewNavigationModel";
import {
  nextReviewNavigationItem,
  reviewNavigationItems,
} from "../../features/pullRequests/domain/reviewNavigationSelection";

function candidate(id: string): ReviewNavigationCandidate {
  return {
    id,
    kind: "conversation",
    rootCommentId: Number(id.replace(/\D/g, "")) || 1,
    placeable: false,
  };
}

suite("Review navigation selection", () => {
  const unresolved = [candidate("u1"), candidate("u2")];
  const pending = [candidate("p1"), candidate("p2"), candidate("p3")];
  const model: ReviewNavigationModel = {
    unresolvedByPath: new Map(),
    unresolved,
    pending,
    placedUnresolved: [],
    placedPending: [],
  };

  test("selects the logical collection for the active mode", () => {
    assert.deepStrictEqual(reviewNavigationItems(model, "unresolved"), unresolved);
    assert.deepStrictEqual(reviewNavigationItems(model, "pending"), pending);
  });

  test("starts at the first or last item depending on navigation direction", () => {
    assert.strictEqual(nextReviewNavigationItem(pending, undefined, 1)?.id, "p1");
    assert.strictEqual(nextReviewNavigationItem(pending, undefined, -1)?.id, "p3");
  });

  test("wraps independently inside each logical cycle", () => {
    assert.strictEqual(nextReviewNavigationItem(unresolved, "u2", 1)?.id, "u1");
    assert.strictEqual(nextReviewNavigationItem(pending, "p1", -1)?.id, "p3");
  });
});
