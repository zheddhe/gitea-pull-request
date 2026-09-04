import * as assert from "assert";
import { PullRequestReviewSessionService } from "../../features/pullRequests/services/pullRequestReviewSessionService";

suite("Pull request review session service", () => {
  const repo = { key: "https://gitea.example|alice/repo" };

  test("keeps pending state isolated per pull request", () => {
    const service = new PullRequestReviewSessionService();
    service.queueInlineComment(repo, 10, {
      id: "inline-1",
      path: "src/a.ts",
      new_position: 4,
      old_position: 0,
      body: "Check this",
    });

    assert.strictEqual(service.get(repo, 10).inlineComments.length, 1);
    assert.deepStrictEqual(service.get(repo, 11), {
      inlineComments: [],
      replies: [],
      conversationActions: [],
    });
    service.dispose();
  });

  test("returns defensive snapshots rather than mutable service state", () => {
    const service = new PullRequestReviewSessionService();
    service.queueReply(repo, 10, {
      id: "reply-1",
      rootCommentId: 42,
      body: "Reply",
    });

    const snapshot = service.get(repo, 10);
    snapshot.replies[0].body = "mutated";
    snapshot.replies.push({ id: "reply-2", rootCommentId: 42, body: "extra" });

    assert.deepStrictEqual(service.get(repo, 10).replies, [
      { id: "reply-1", rootCommentId: 42, body: "Reply" },
    ]);
    service.dispose();
  });

  test("shares conversation lifecycle semantics with the domain model", () => {
    const service = new PullRequestReviewSessionService();
    service.queueConversationAction(repo, 10, {
      id: "resolve-1",
      rootCommentId: 42,
      action: "resolve",
    });
    service.queueConversationAction(repo, 10, {
      id: "reopen-1",
      rootCommentId: 42,
      action: "reopen",
    });

    assert.deepStrictEqual(service.get(repo, 10).conversationActions, [
      { id: "reopen-1", rootCommentId: 42, action: "reopen" },
    ]);

    service.queueConversationAction(repo, 10, {
      id: "reopen-2",
      rootCommentId: 42,
      action: "reopen",
    });
    assert.deepStrictEqual(service.get(repo, 10).conversationActions, []);
    service.dispose();
  });

  test("replaces duplicate pending ids within each operation type", () => {
    const service = new PullRequestReviewSessionService();
    service.queueInlineComment(repo, 10, {
      id: "inline-1",
      path: "src/a.ts",
      new_position: 4,
      old_position: 0,
      body: "first",
    });
    service.queueInlineComment(repo, 10, {
      id: "inline-1",
      path: "src/a.ts",
      new_position: 5,
      old_position: 0,
      body: "updated",
    });
    service.queueReply(repo, 10, {
      id: "reply-1",
      rootCommentId: 42,
      body: "first",
    });
    service.queueReply(repo, 10, {
      id: "reply-1",
      rootCommentId: 42,
      body: "updated",
    });

    assert.deepStrictEqual(service.get(repo, 10), {
      inlineComments: [
        {
          id: "inline-1",
          path: "src/a.ts",
          new_position: 5,
          old_position: 0,
          body: "updated",
        },
      ],
      replies: [{ id: "reply-1", rootCommentId: 42, body: "updated" }],
      conversationActions: [],
    });
    service.dispose();
  });

  test("removes one pending operation by id without disturbing the rest", () => {
    const service = new PullRequestReviewSessionService();
    service.replace(repo, 10, {
      inlineComments: [
        {
          id: "inline-1",
          path: "src/a.ts",
          new_position: 4,
          old_position: 0,
          body: "A",
        },
      ],
      replies: [{ id: "reply-1", rootCommentId: 42, body: "Reply" }],
      conversationActions: [
        { id: "resolve-1", rootCommentId: 43, action: "resolve" },
      ],
    });

    service.remove(repo, 10, "reply-1");

    assert.deepStrictEqual(service.get(repo, 10), {
      inlineComments: [
        {
          id: "inline-1",
          path: "src/a.ts",
          new_position: 4,
          old_position: 0,
          body: "A",
        },
      ],
      replies: [],
      conversationActions: [
        { id: "resolve-1", rootCommentId: 43, action: "resolve" },
      ],
    });
    service.dispose();
  });

  test("reconciles only operations confirmed by submission", () => {
    const service = new PullRequestReviewSessionService();
    service.replace(repo, 10, {
      inlineComments: [
        {
          id: "inline-ok",
          path: "src/a.ts",
          new_position: 4,
          old_position: 0,
          body: "A",
        },
        {
          id: "inline-failed",
          path: "src/b.ts",
          new_position: 8,
          old_position: 0,
          body: "B",
        },
      ],
      replies: [{ id: "reply-ok", rootCommentId: 42, body: "Reply" }],
      conversationActions: [
        { id: "resolve-failed", rootCommentId: 43, action: "resolve" },
      ],
    });

    const remaining = service.reconcile(repo, 10, {
      succeededInlineCommentIds: ["inline-ok"],
      succeededReplyIds: ["reply-ok"],
      succeededConversationActionIds: [],
      errors: ["resolve failed"],
    });

    assert.deepStrictEqual(remaining, {
      inlineComments: [
        {
          id: "inline-failed",
          path: "src/b.ts",
          new_position: 8,
          old_position: 0,
          body: "B",
        },
      ],
      replies: [],
      conversationActions: [
        { id: "resolve-failed", rootCommentId: 43, action: "resolve" },
      ],
    });
    service.dispose();
  });

  test("emits one normalized snapshot for each mutation", () => {
    const service = new PullRequestReviewSessionService();
    const changes: number[] = [];
    const disposable = service.onDidChange((change) => {
      changes.push(
        change.session.inlineComments.length +
          change.session.replies.length +
          change.session.conversationActions.length,
      );
    });

    service.queueReply(repo, 10, {
      id: "reply-1",
      rootCommentId: 42,
      body: "Reply",
    });
    service.remove(repo, 10, "reply-1");

    assert.deepStrictEqual(changes, [1, 0]);
    disposable.dispose();
    service.dispose();
  });

  test("clears one pull request without affecting another", () => {
    const service = new PullRequestReviewSessionService();
    service.queueReply(repo, 10, {
      id: "reply-10",
      rootCommentId: 10,
      body: "A",
    });
    service.queueReply(repo, 11, {
      id: "reply-11",
      rootCommentId: 11,
      body: "B",
    });

    const cleared = service.clear(repo, 10);

    assert.deepStrictEqual(cleared, {
      inlineComments: [],
      replies: [],
      conversationActions: [],
    });
    assert.deepStrictEqual(service.get(repo, 10), cleared);
    assert.strictEqual(service.get(repo, 11).replies.length, 1);
    service.dispose();
  });

  test("can clear all sessions belonging to an unavailable repository", () => {
    const service = new PullRequestReviewSessionService();
    const otherRepo = { key: "https://gitea.example|bob/repo" };
    service.queueReply(repo, 10, {
      id: "reply-a",
      rootCommentId: 1,
      body: "A",
    });
    service.queueReply(otherRepo, 20, {
      id: "reply-b",
      rootCommentId: 2,
      body: "B",
    });

    service.clearRepository(repo.key);

    assert.strictEqual(service.get(repo, 10).replies.length, 0);
    assert.strictEqual(service.get(otherRepo, 20).replies.length, 1);
    service.dispose();
  });
});
