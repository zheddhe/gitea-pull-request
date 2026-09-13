import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("PR Detail review continuity presentation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/prDetailPanel.ts"),
    "utf8",
  );

  test("renders outdated conversations separately without changing resolved state", () => {
    assert.match(source, /projectReviewConversationsForHead/);
    assert.match(source, /groupUnplacedReviewConversations/);
    assert.match(source, /Outdated conversations \(\$\{groupedUnplaced\.outdated\.length\}\)/);
    assert.match(source, /conversation-outdated-badge/);
    assert.match(source, /Their resolved state is preserved independently/);
  });

  test("exposes independent unresolved and pending navigation controls", () => {
    assert.match(source, /id="unresolved-navigation-group"/);
    assert.match(source, /id="previous-unresolved"/);
    assert.match(source, /id="next-unresolved"/);
    assert.match(source, /id="pending-navigation-group"/);
    assert.match(source, /id="previous-pending"/);
    assert.match(source, /id="next-pending"/);
    assert.match(source, /navigateReview\('unresolved',-1\)/);
    assert.match(source, /navigateReview\('pending',1\)/);
  });

  test("projects the extension-host logical cursor instead of advancing locally", () => {
    assert.match(source, /case "navigateReviewNavigation"/);
    assert.match(source, /"gitea\.navigateReviewNavigation"/);
    assert.match(source, /case "requestReviewNavigationState"/);
    assert.match(source, /"gitea\.getReviewNavigationState"/);
    assert.match(source, /type: "reviewNavigationStateChanged"/);
    assert.match(source, /applyReviewNavigationState\(message\.state\)/);
    assert.match(source, /post\('requestReviewNavigationState'\)/);
  });

  test("uses the same logical ids for persisted conversations and pending operations", () => {
    assert.match(source, /data-nav-id="conversation:\$\{root\.id\}"/);
    assert.match(source, /pending\.dataset\.navId='pending:'\+item\.id/);
    assert.match(source, /chip\.dataset\.navId='pending:'\+item\.id/);
  });
});
