import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import { emptyPendingReviewSession } from "../../features/pullRequests/domain/pendingReviewSession";
import {
  buildReviewNavigationModel,
  nextReviewNavigationIndex,
} from "../../features/pullRequests/domain/reviewNavigationModel";
import { buildReviewConversations } from "../../features/pullRequests/domain/reviewConversationModel";

const user: GiteaUser = {
  id: 1,
  login: "reviewer",
  full_name: "Reviewer",
  email: "reviewer@example.test",
  avatar_url: "",
};

function comment(
  id: number,
  path: string,
  position: number,
  originalPosition = position,
  extra: Partial<GiteaReviewComment> = {},
): GiteaReviewComment {
  return {
    id,
    user,
    body: `comment ${id}`,
    path,
    position,
    original_position: originalPosition,
    created_at: `2026-09-06T12:00:${String(id).padStart(2, "0")}Z`,
    updated_at: `2026-09-06T12:00:${String(id).padStart(2, "0")}Z`,
    ...extra,
  };
}

suite("Review navigation model", () => {
  test("counts unresolved conversations per file independently from reviewed state", () => {
    const conversations = buildReviewConversations([
      comment(1, "src/a.ts", 8),
      comment(2, "src/a.ts", 12),
      comment(3, "src/b.ts", 4, 4, { resolver: user }),
    ]);

    const model = buildReviewNavigationModel(
      conversations,
      emptyPendingReviewSession(),
    );

    assert.strictEqual(model.unresolvedByPath.get("src/a.ts"), 2);
    assert.strictEqual(model.unresolvedByPath.has("src/b.ts"), false);
  });

  test("uses pending lifecycle state when deriving unresolved signal", () => {
    const conversations = buildReviewConversations([
      comment(1, "src/a.ts", 8),
      comment(2, "src/b.ts", 4, 4, { resolver: user }),
    ]);

    const model = buildReviewNavigationModel(conversations, {
      inlineComments: [],
      replies: [],
      conversationActions: [
        { id: "resolve-1", rootCommentId: 1, action: "resolve" },
        { id: "reopen-2", rootCommentId: 2, action: "reopen" },
      ],
    });

    assert.strictEqual(model.unresolvedByPath.has("src/a.ts"), false);
    assert.strictEqual(model.unresolvedByPath.get("src/b.ts"), 1);
    assert.deepStrictEqual(
      model.placedUnresolved.map((item) => item.rootCommentId),
      [2],
    );
  });

  test("orders placed unresolved conversations deterministically by path side line and id", () => {
    const conversations = buildReviewConversations([
      comment(4, "src/z.ts", 7),
      comment(3, "src/a.ts", 9),
      comment(2, "src/a.ts", 0, 5),
      comment(1, "src/a.ts", 3),
    ]);

    const model = buildReviewNavigationModel(
      conversations,
      emptyPendingReviewSession(),
    );

    assert.deepStrictEqual(
      model.placedUnresolved.map((item) => [
        item.path,
        item.side,
        item.line,
        item.rootCommentId,
      ]),
      [
        ["src/a.ts", "base", 5, 2],
        ["src/a.ts", "head", 3, 1],
        ["src/a.ts", "head", 9, 3],
        ["src/z.ts", "head", 7, 4],
      ],
    );
  });

  test("keeps unplaceable unresolved conversations in file counts but out of native navigation", () => {
    const conversations = buildReviewConversations([
      comment(1, "src/a.ts", 0, 0),
      comment(2, "src/a.ts", 6),
    ]);

    const model = buildReviewNavigationModel(
      conversations,
      emptyPendingReviewSession(),
    );

    assert.strictEqual(model.unresolvedByPath.get("src/a.ts"), 2);
    assert.deepStrictEqual(
      model.placedUnresolved.map((item) => item.rootCommentId),
      [2],
    );
  });

  test("cycles next and previous through every unresolved target", () => {
    let index = -1;
    index = nextReviewNavigationIndex(index, 3, 1);
    assert.strictEqual(index, 0);
    index = nextReviewNavigationIndex(index, 3, 1);
    assert.strictEqual(index, 1);
    index = nextReviewNavigationIndex(index, 3, 1);
    assert.strictEqual(index, 2);
    index = nextReviewNavigationIndex(index, 3, 1);
    assert.strictEqual(index, 0);

    index = nextReviewNavigationIndex(index, 3, -1);
    assert.strictEqual(index, 2);
    index = nextReviewNavigationIndex(index, 3, -1);
    assert.strictEqual(index, 1);
    index = nextReviewNavigationIndex(index, 3, -1);
    assert.strictEqual(index, 0);
  });
});
