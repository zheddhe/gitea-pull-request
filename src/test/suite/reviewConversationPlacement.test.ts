import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import {
  buildReviewConversations,
  projectReviewConversationsForHead,
  type ReviewConversation,
} from "../../features/pullRequests/domain/reviewConversationModel";
import { resolveReviewConversationPlacement } from "../../features/pullRequests/domain/reviewConversationPlacement";

const user: GiteaUser = {
  id: 1,
  login: "reviewer",
  full_name: "Reviewer",
  email: "reviewer@example.test",
  avatar_url: "",
};

function comment(options: Partial<GiteaReviewComment> = {}): GiteaReviewComment {
  return {
    id: 1,
    user,
    body: "review comment",
    path: "src/example.ts",
    created_at: "2026-09-04T20:00:00Z",
    updated_at: "2026-09-04T20:00:00Z",
    ...options,
  };
}

function conversation(options: Partial<GiteaReviewComment>): ReviewConversation {
  return buildReviewConversations([comment(options)])[0];
}

suite("Review conversation placement", () => {
  test("prefers the authoritative new-file line when available", () => {
    assert.deepStrictEqual(
      resolveReviewConversationPlacement(
        conversation({ position: 18, original_position: 17 }),
      ),
      { kind: "placed", side: "head", path: "src/example.ts", line: 18 },
    );
  });

  test("places deletions on the base side when only an old-file line exists", () => {
    assert.deepStrictEqual(
      resolveReviewConversationPlacement(
        conversation({ position: 0, original_position: 7 }),
      ),
      { kind: "placed", side: "base", path: "src/example.ts", line: 7 },
    );
  });

  test("keeps compatibility aliases for existing Gitea comment payloads", () => {
    assert.deepStrictEqual(
      resolveReviewConversationPlacement(
        conversation({ new_position: 21, old_position: 20 }),
      ),
      { kind: "placed", side: "head", path: "src/example.ts", line: 21 },
    );
  });

  test("refuses orphan replies rather than attaching them to their reported line", () => {
    const orphan = buildReviewConversations([
      comment({ in_reply_to_id: 999, position: 12 }),
    ])[0];

    assert.deepStrictEqual(resolveReviewConversationPlacement(orphan), {
      kind: "unplaceable",
      reason: "orphaned",
    });
  });

  test("refuses conversations without a reliable line", () => {
    assert.deepStrictEqual(
      resolveReviewConversationPlacement(conversation({ position: 0, original_position: 0 })),
      { kind: "unplaceable", reason: "missingLine" },
    );
  });

  test("keeps a resolved historical conversation resolved but unplaceable after head changes", () => {
    const resolved = buildReviewConversations([
      comment({
        commit_id: "old-head",
        position: 11,
        original_position: 10,
        new_position: 11,
        old_position: 10,
        resolver: user,
      }),
    ]);

    const [projected] = projectReviewConversationsForHead(resolved, "new-head");
    assert.ok(projected);
    assert.strictEqual(projected.resolved, true);
    assert.strictEqual(projected.resolver?.id, user.id);
    assert.strictEqual(projected.outdated, true);
    assert.strictEqual(projected.root.position, 11);
    assert.strictEqual(projected.root.original_position, 10);
    assert.strictEqual(projected.root.new_position, 0);
    assert.strictEqual(projected.root.old_position, 0);
    assert.deepStrictEqual(resolveReviewConversationPlacement(projected), {
      kind: "unplaceable",
      reason: "outdated",
    });
  });

  test("keeps a current resolved conversation placeable", () => {
    const resolved = buildReviewConversations([
      comment({
        commit_id: "current-head",
        position: 11,
        new_position: 11,
        resolver: user,
      }),
    ]);

    const [projected] = projectReviewConversationsForHead(resolved, "current-head");
    assert.strictEqual(projected.outdated, false);
    assert.strictEqual(projected.resolved, true);
    assert.deepStrictEqual(resolveReviewConversationPlacement(projected), {
      kind: "placed",
      side: "head",
      path: "src/example.ts",
      line: 11,
    });
  });
});
