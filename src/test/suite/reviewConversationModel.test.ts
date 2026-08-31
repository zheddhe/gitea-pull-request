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

  test("groups comments on the same Gitea code anchor when reply metadata is absent", () => {
    const conversations = buildReviewConversations([
      comment(1),
      comment(2),
      comment(3),
    ]);

    assert.strictEqual(conversations.length, 1);
    assert.strictEqual(conversations[0].root.id, 1);
    assert.deepStrictEqual(conversations[0].replies.map((reply) => reply.id), [2, 3]);
  });

  test("keeps comments on different code anchors in separate conversations", () => {
    const conversations = buildReviewConversations([
      comment(1, { position: 10, original_position: 10 }),
      comment(2, { position: 11, original_position: 11 }),
      comment(3, { path: "src/other.ts", position: 10, original_position: 10 }),
    ]);

    assert.strictEqual(conversations.length, 3);
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

  test("marks a conversation resolved when any Gitea comment on the anchor has a resolver", () => {
    const resolver = { ...user, id: 2, login: "resolver" };
    const conversations = buildReviewConversations([
      comment(1),
      comment(2, { resolver }),
    ]);

    assert.strictEqual(conversations[0].resolved, true);
    assert.strictEqual(conversations[0].resolver?.login, "resolver");
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
