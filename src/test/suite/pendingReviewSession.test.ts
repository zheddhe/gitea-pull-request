import * as assert from "assert";
import {
  countPendingReviewActions,
  emptyPendingReviewSession,
  queueConversationAction,
  reconcilePendingReviewSubmission,
  type PendingReviewSession,
} from "../../features/pullRequests/domain/pendingReviewSession";

suite("PendingReviewSession", () => {
  test("counts all review mutations in a single session", () => {
    const session: PendingReviewSession = {
      inlineComments: [
        {
          id: "inline-1",
          path: "src/example.ts",
          new_position: 10,
          old_position: 0,
          body: "inline",
        },
      ],
      replies: [{ id: "reply-1", rootCommentId: 42, body: "reply" }],
      conversationActions: [
        { id: "action-1", rootCommentId: 42, action: "resolve" },
      ],
    };

    assert.strictEqual(countPendingReviewActions(session), 3);
  });

  test("keeps only one desired lifecycle transition per conversation", () => {
    const initial = emptyPendingReviewSession();
    const resolving = queueConversationAction(initial, {
      id: "resolve-1",
      rootCommentId: 42,
      action: "resolve",
    });
    const reopening = queueConversationAction(resolving, {
      id: "reopen-1",
      rootCommentId: 42,
      action: "reopen",
    });

    assert.deepStrictEqual(reopening.conversationActions, [
      { id: "reopen-1", rootCommentId: 42, action: "reopen" },
    ]);
  });

  test("queues the same lifecycle transition twice as a cancellation", () => {
    const initial = queueConversationAction(emptyPendingReviewSession(), {
      id: "resolve-1",
      rootCommentId: 42,
      action: "resolve",
    });
    const cancelled = queueConversationAction(initial, {
      id: "resolve-2",
      rootCommentId: 42,
      action: "resolve",
    });

    assert.deepStrictEqual(cancelled.conversationActions, []);
  });

  test("removes only operations explicitly confirmed by the server", () => {
    const session: PendingReviewSession = {
      inlineComments: [
        {
          id: "inline-ok",
          path: "src/example.ts",
          new_position: 10,
          old_position: 0,
          body: "ok",
        },
        {
          id: "inline-retry",
          path: "src/example.ts",
          new_position: 11,
          old_position: 0,
          body: "retry",
        },
      ],
      replies: [
        { id: "reply-ok", rootCommentId: 42, body: "ok" },
        { id: "reply-retry", rootCommentId: 43, body: "retry" },
      ],
      conversationActions: [
        { id: "action-ok", rootCommentId: 42, action: "resolve" },
        { id: "action-retry", rootCommentId: 43, action: "resolve" },
      ],
    };

    const remaining = reconcilePendingReviewSubmission(session, {
      succeededInlineCommentIds: ["inline-ok"],
      succeededReplyIds: ["reply-ok"],
      succeededConversationActionIds: ["action-ok"],
      errors: ["three operations failed"],
    });

    assert.deepStrictEqual(
      remaining.inlineComments.map((item) => item.id),
      ["inline-retry"],
    );
    assert.deepStrictEqual(
      remaining.replies.map((item) => item.id),
      ["reply-retry"],
    );
    assert.deepStrictEqual(
      remaining.conversationActions.map((item) => item.id),
      ["action-retry"],
    );
  });
});
