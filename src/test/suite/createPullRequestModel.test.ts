import * as assert from "assert";
import {
  draftTitle,
  reconcileBranchSelection,
  suggestTitleFromBranch,
  validBranchPair,
} from "../../features/pullRequests/domain/createPullRequestModel";

suite("CreatePullRequestModel", () => {
  test("suggests a readable title from common branch naming", () => {
    assert.strictEqual(
      suggestTitleFromBranch("feature/sidebar-pr-metadata"),
      "Sidebar pr metadata",
    );
    assert.strictEqual(
      suggestTitleFromBranch("fix/requestReviewerFlow"),
      "Request Reviewer Flow",
    );
  });

  test("draft title adds WIP only once", () => {
    assert.strictEqual(draftTitle("Add metadata"), "WIP: Add metadata");
    assert.strictEqual(draftTitle("WIP: Add metadata"), "WIP: Add metadata");
    assert.strictEqual(draftTitle("[WIP] Add metadata"), "[WIP] Add metadata");
  });

  test("valid branch pair rejects identical or empty refs", () => {
    assert.strictEqual(validBranchPair("main", "feature/test"), true);
    assert.strictEqual(validBranchPair("main", "main"), false);
    assert.strictEqual(validBranchPair("", "feature/test"), false);
  });

  test("branch refresh preserves valid base and head", () => {
    assert.deepStrictEqual(
      reconcileBranchSelection(
        ["master", "feature/current", "feature/new"],
        "master",
        "feature/current",
        "feature/current",
      ),
      { baseBranch: "master", headBranch: "feature/current" },
    );
  });

  test("branch refresh falls back coherently when selected refs disappear", () => {
    assert.deepStrictEqual(
      reconcileBranchSelection(
        ["master", "feature/current", "feature/new"],
        "deleted-base",
        "deleted-head",
        "feature/current",
      ),
      { baseBranch: "master", headBranch: "feature/current" },
    );

    assert.deepStrictEqual(
      reconcileBranchSelection(
        ["release", "feature/new"],
        "deleted-base",
        "deleted-head",
      ),
      { baseBranch: "feature/new", headBranch: "release" },
    );
  });
});
