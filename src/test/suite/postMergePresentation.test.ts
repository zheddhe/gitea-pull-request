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

  test("uses primary buttons and describes the verified-safe cleanup path without danger styling", () => {
    assert.match(
      source,
      /id="delete" title="Return to the base branch and clean up only source branches verified safe\."/,
    );
    assert.doesNotMatch(source, /class="danger-outline"/);
    assert.doesNotMatch(source, /class="secondary"/);
    assert.match(source, /\.actions \{ display: flex; flex-wrap: wrap;/);
  });

  test("removes refresh and close instructional footer", () => {
    assert.doesNotMatch(source, /Use the ↻ title action/);
    assert.doesNotMatch(source, /keep branches and finish/);
  });

  test("preserves checkout semantics and revalidates branch safety before cleanup", () => {
    assert.match(source, /case "deleteBranches":[\s\S]*?await this\.deleteBranches\(state\)/);
    assert.match(source, /case "checkoutBase":[\s\S]*?await this\.checkoutBase\(state\)/);

    assert.match(
      source,
      /identity = await this\.branchCleanup\.discover\([\s\S]*?state\.pullRequest\.head\.ref,[\s\S]*?state\.pullRequest\.base\.ref/,
    );
    assert.match(
      source,
      /this\.branchSync\.analyzePostMergeCleanup\([\s\S]*?repoInfo,[\s\S]*?identity,[\s\S]*?state\.pullRequest\.head\.sha/,
    );
    assert.match(
      source,
      /this\.branchCleanup\.cleanup\(repoInfo, identity, \{[\s\S]*?forceLocal: deleteLocal && localSafe/,
    );
    assert.match(
      source,
      /this\.branchCleanup\.checkoutBase\(context\.repoInfo, context\.identity\)/,
    );
  });
});
