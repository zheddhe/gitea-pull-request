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
    assert.match(source, /conversation-outdated\{border-left-color:var\(--danger\)\}/);
    assert.match(source, /conversation-outdated-badge\{color:var\(--danger\)/);
    assert.match(source, /outdated-inline \.section-heading\{color:var\(--danger\)\}/);
    assert.match(source, /Their resolved state is preserved independently/);
  });

  test("exposes separated unresolved and pending navigation groups with adjacent controls", () => {
    assert.match(source, /id="unresolved-navigation-group"/);
    assert.match(source, /id="unresolved-navigation-actions"/);
    assert.match(source, /id="previous-unresolved"/);
    assert.match(source, /id="next-unresolved"/);
    assert.match(source, /id="pending-navigation-group" class="review-navigation-group pending-navigation-group"/);
    assert.match(source, /id="pending-navigation-actions"/);
    assert.match(source, /id="previous-pending"/);
    assert.match(source, /id="next-pending"/);
    assert.match(source, /review-navigation-group\+ \.review-navigation-group\{border-left:1px solid var\(--border\)/);
    assert.match(source, /pending-navigation-group \.review-navigation-label/);
    assert.match(source, /navigateReview\('unresolved',-1\)/);
    assert.match(source, /navigateReview\('pending',1\)/);
  });

  test("hides previous and next buttons for single-item cycles", () => {
    assert.match(
      source,
      /unresolvedActions\.hidden=unresolved\.items\.length<=1/,
    );
    assert.match(source, /pendingActions\.hidden=pending\.items\.length<=1/);
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
