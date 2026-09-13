import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import { buildReviewConversations } from "../../features/pullRequests/domain/reviewConversationModel";
import { markOutdatedConversations } from "../../features/pullRequests/services/pullRequestConversationService";

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
    created_at: "2026-09-13T10:00:00Z",
    updated_at: "2026-09-13T10:05:00Z",
    ...options,
  };
}

suite("Outdated conversation state", () => {
  test("outdated classification never changes persisted resolution", () => {
    const conversations = buildReviewConversations([root()]);
    const marked = markOutdatedConversations(conversations, "new-head");

    assert.strictEqual(marked[0].outdated, true);
    assert.strictEqual(marked[0].resolved, true);
    assert.strictEqual(marked[0].resolver?.login, "reviewer");
  });

  test("current-head conversation remains current and resolved", () => {
    const conversations = buildReviewConversations([
      root({ commit_id: "new-head" }),
    ]);
    const marked = markOutdatedConversations(conversations, "new-head");

    assert.strictEqual(marked[0].outdated, false);
    assert.strictEqual(marked[0].resolved, true);
  });
});
