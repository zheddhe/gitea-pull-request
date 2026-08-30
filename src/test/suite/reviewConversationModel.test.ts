import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import {
  buildReviewConversations,
  conversationCommentIds,
} from "../../features/pullRequests/domain/reviewConversationModel";

const user: GiteaUser = {
  id: 1,
  login: "reviewer",
  full_name: "Reviewer",
  email: "reviewer@example.test",
  avatar_url: "",
};

function comment(
  id: number,
  options: Partial<GiteaReviewComment> = {},
): GiteaReviewComment {
  return {
    id,
    user,
    body: `comment ${id}`,
    path: "src/example.ts",
    position: 10,
    original_position: 10,
    created_at: `2026-08-30T20:00:${String(id).padStart(2, "0")}Z`,
    updated_at: `2026-08-30T20:00:${String(id).padStart(2, "0")}Z`,
    ...options,
  };
}

suite("ReviewConversationModel", () => {
  test("groups replies under their top-level review comment", () => {
    const conversations = buildReviewConversations([
      comment(1),
      comment(2, { in_reply_to_id: 1 }),
      comment(3, { in_reply_to_id: 1 }),
    ]);

    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(conversations[0].root.id, 1);
    assert.deepStrictEqual(conversations[0].replies.map((reply) => reply.id), [2, 3]);
    assert.deepStrictEqual(conversationCommentIds(conversations[0]), [1, 2, 3]);
  });

  test("defensively resolves a reply-to-reply relation to the conversation root", () => {
    const conversations = buildReviewConversations([
      comment(1),
      comment(2, { in_reply_to_id: 1 }),
      comment(3, { in_reply_to_id: 2 }),
    ]);

    assert.strictEqual(conversations.length, 1);
    assert.deepStrictEqual(conversations[0].replies.map((reply) => reply.id), [2, 3]);
  });

  test("marks a conversation resolved when Gitea returns a resolver on its root", () => {
    const conversations = buildReviewConversations([
      comment(1, { resolver: { ...user, id: 2, login: "resolver" } }),
    ]);

    assert.strictEqual(conversations[0].resolved, true);
  });

  test("keeps orphan replies explicit instead of attaching them to an unrelated line", () => {
    const conversations = buildReviewConversations([
      comment(9, { in_reply_to_id: 999 }),
    ]);

    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(conversations[0].root.id, 9);
    assert.strictEqual(conversations[0].orphaned, true);
  });
});
