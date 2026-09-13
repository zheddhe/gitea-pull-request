import * as assert from "assert";
import {
  findReviewSubmissionSuccessor,
  type ReviewSubmissionContinuity,
} from "../../features/pullRequests/domain/reviewNavigationContinuity";
import type {
  ReviewNavigationCandidate,
  ReviewNavigationModel,
} from "../../features/pullRequests/domain/reviewNavigationModel";

suite("Review navigation submission continuity", () => {
  test("follows a submitted reply back to its persisted conversation", () => {
    const pending: ReviewNavigationCandidate = {
      id: "pending:reply-1",
      kind: "reply",
      pendingId: "reply-1",
      rootCommentId: 41,
      placeable: true,
      path: "src/a.ts",
      side: "head",
      line: 12,
    };
    const conversation = candidate(41, "src/a.ts", 12);

    assert.strictEqual(
      findReviewSubmissionSuccessor(continuity(pending), model([conversation])),
      conversation,
    );
  });

  test("follows one newly persisted inline comment at the exact anchor", () => {
    const pending: ReviewNavigationCandidate = {
      id: "pending:inline-1",
      kind: "inline-comment",
      pendingId: "inline-1",
      placeable: true,
      path: "src/a.ts",
      side: "head",
      line: 12,
    };
    const existing = candidate(41, "src/a.ts", 12);
    const created = candidate(52, "src/a.ts", 12);

    assert.strictEqual(
      findReviewSubmissionSuccessor(
        {
          item: pending,
          knownConversationRootIds: new Set([41]),
        },
        model([existing, created]),
      ),
      created,
    );
  });

  test("never guesses between several new conversations at the same anchor", () => {
    const pending: ReviewNavigationCandidate = {
      id: "pending:inline-1",
      kind: "inline-comment",
      pendingId: "inline-1",
      placeable: true,
      path: "src/a.ts",
      side: "head",
      line: 12,
    };

    assert.strictEqual(
      findReviewSubmissionSuccessor(
        continuity(pending),
        model([
          candidate(52, "src/a.ts", 12),
          candidate(53, "src/a.ts", 12),
        ]),
      ),
      undefined,
    );
  });

  test("does not retain a resolved lifecycle action in unresolved navigation", () => {
    const pending: ReviewNavigationCandidate = {
      id: "pending:resolve-41",
      kind: "conversation-action",
      pendingId: "resolve-41",
      rootCommentId: 41,
      placeable: true,
      path: "src/a.ts",
      side: "head",
      line: 12,
    };

    assert.strictEqual(
      findReviewSubmissionSuccessor(continuity(pending), model([])),
      undefined,
    );
  });

  test("does not invent a successor when persistence produced no conversation", () => {
    const pending: ReviewNavigationCandidate = {
      id: "pending:inline-failed",
      kind: "inline-comment",
      pendingId: "inline-failed",
      placeable: true,
      path: "src/a.ts",
      side: "head",
      line: 12,
    };

    assert.strictEqual(
      findReviewSubmissionSuccessor(continuity(pending), model([])),
      undefined,
    );
  });
});

function continuity(item: ReviewNavigationCandidate): ReviewSubmissionContinuity {
  return { item, knownConversationRootIds: new Set() };
}

function candidate(
  rootCommentId: number,
  path: string,
  line: number,
): ReviewNavigationCandidate {
  return {
    id: `conversation:${rootCommentId}`,
    kind: "conversation",
    rootCommentId,
    path,
    side: "head",
    line,
    placeable: true,
  };
}

function model(unresolved: ReviewNavigationCandidate[]): ReviewNavigationModel {
  return {
    unresolvedByPath: new Map(),
    unresolved,
    pending: [],
    placedUnresolved: unresolved.filter(
      (item): item is ReviewNavigationModel["placedUnresolved"][number] =>
        item.placeable &&
        !!item.path &&
        item.side !== undefined &&
        item.line !== undefined,
    ),
    placedPending: [],
  };
}
