import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Post-merge presentation", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/postMergePullRequestView.ts",
    ),
    "utf8",
  );

  test("uses compact branch-lifecycle outcome labels", () => {
    assert.match(source, />✓ Checkout Base \/ Delete Source<\/button>/);
    assert.match(source, />Checkout Base \/ Keep Source<\/button>/);
    assert.match(source, />Create New Pull Request<\/button>/);

    assert.doesNotMatch(source, /Delete Branch…/);
    assert.doesNotMatch(source, /Create New Pull Request…/);
    assert.doesNotMatch(source, /without deleting branch/);
  });

  test("uses primary buttons and emphasizes the recommended cleanup path without danger styling", () => {
    assert.match(source, /id="delete" title="Recommended:/);
    assert.doesNotMatch(source, /class="danger-outline"/);
    assert.doesNotMatch(source, /class="secondary"/);
    assert.match(source, /\.actions \{ display: flex; flex-wrap: wrap;/);
  });

  test("removes refresh and close instructional footer", () => {
    assert.doesNotMatch(source, /Use the ↻ title action/);
    assert.doesNotMatch(source, /keep branches and finish/);
  });

  test("preserves existing branch cleanup and checkout command semantics", () => {
    assert.match(source, /case "deleteBranches":[\s\S]*?await this\.deleteBranches\(state\)/);
    assert.match(source, /case "checkoutBase":[\s\S]*?await this\.checkoutBase\(state\)/);
    assert.match(source, /this\.branchCleanup\.cleanup\(context\.repoInfo, context\.identity/);
    assert.match(source, /this\.branchCleanup\.checkoutBase\(context\.repoInfo, context\.identity\)/);
  });
});
