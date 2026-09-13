import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import {
  buildReviewConversations,
  projectReviewConversationsForHead,
} from "../../features/pullRequests/domain/reviewConversationModel";

const user: GiteaUser = {
  id: 1,
  login: "reviewer",
  full_name: "Reviewer",
  email: "reviewer@example.test",
  avatar_url: "",
};

function root(options: Partial<GiteaReviewComment> = {}): GiteaReviewComment {
  return {
    id: 10,
    user,
    resolver: user,
    body: "resolved historical comment",
    path: "src/example.ts",
    commit_id: "old-head",
    position: 12,
    new_position: 12,
    created_at: "2026-09-13T10:00:00Z",
    updated_at: "2026-09-13T10:05:00Z",
    ...options,
  };
}

suite("Review conversation head projection", () => {
  test("outdated classification preserves persisted resolution", () => {
    const [conversation] = projectReviewConversationsForHead(
      buildReviewConversations([root()]),
      "new-head",
    );

    assert.strictEqual(conversation.outdated, true);
    assert.strictEqual(conversation.resolved, true);
    assert.strictEqual(conversation.resolver?.login, "reviewer");
    assert.strictEqual(conversation.root.new_position, 0);
    assert.strictEqual(conversation.root.position, 12);
  });

  test("current-head resolved conversation keeps its current placement", () => {
    const [conversation] = projectReviewConversationsForHead(
      buildReviewConversations([root({ commit_id: "new-head" })]),
      "new-head",
    );

    assert.strictEqual(conversation.outdated, false);
    assert.strictEqual(conversation.resolved, true);
    assert.strictEqual(conversation.root.new_position, 12);
  });
});
