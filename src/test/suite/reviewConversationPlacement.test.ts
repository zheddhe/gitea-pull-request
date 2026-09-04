import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import {
  buildReviewConversations,
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
});
