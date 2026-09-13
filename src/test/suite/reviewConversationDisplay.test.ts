import * as assert from "assert";
import type { GiteaReviewComment, GiteaUser } from "../../api/types";
import {
  buildReviewConversations,
  type ReviewConversation,
} from "../../features/pullRequests/domain/reviewConversationModel";
import { groupUnplacedReviewConversations } from "../../features/pullRequests/domain/reviewConversationDisplay";

const user: GiteaUser = {
  id: 1,
  login: "reviewer",
  full_name: "Reviewer",
  email: "reviewer@example.test",
  avatar_url: "",
};

function conversation(id: number, outdated = false): ReviewConversation {
  const root: GiteaReviewComment = {
    id,
    user,
    body: `comment ${id}`,
    path: "src/example.ts",
    position: id,
    created_at: `2026-09-13T10:00:0${id}Z`,
    updated_at: `2026-09-13T10:00:0${id}Z`,
  };
  const item = buildReviewConversations([root])[0];
  item.outdated = outdated;
  return item;
}

suite("Review conversation display groups", () => {
  test("keeps outdated conversations separate from other unplaced fallbacks", () => {
    const current = conversation(1);
    const outdated = conversation(2, true);
    const unplaced = conversation(3);

    const groups = groupUnplacedReviewConversations(
      [current, outdated, unplaced],
      new Set([current.root.id]),
    );

    assert.deepStrictEqual(groups.outdated.map((item) => item.root.id), [2]);
    assert.deepStrictEqual(groups.unplaced.map((item) => item.root.id), [3]);
  });

  test("does not classify an already inline-rendered outdated conversation twice", () => {
    const outdated = conversation(4, true);
    const groups = groupUnplacedReviewConversations(
      [outdated],
      new Set([outdated.root.id]),
    );

    assert.deepStrictEqual(groups, { outdated: [], unplaced: [] });
  });
});
