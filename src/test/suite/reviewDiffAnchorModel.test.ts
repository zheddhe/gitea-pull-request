import * as assert from "assert";
import { buildReviewDiffAnchorIndex } from "../../features/pullRequests/domain/reviewDiffAnchorModel";

suite("Review diff anchor model", () => {
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 111..222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -2,4 +2,5 @@",
    " keep-2",
    "-old-3",
    "+new-3",
    "+new-4",
    " keep-4",
    " keep-5",
    "",
  ].join("\n");

  test("indexes only lines represented by diff hunks", () => {
    const index = buildReviewDiffAnchorIndex(diff);
    assert.deepStrictEqual(index.lines("src/example.ts", "base"), [2, 3, 4, 5]);
    assert.deepStrictEqual(index.lines("src/example.ts", "head"), [2, 3, 4, 5, 6]);
    assert.strictEqual(index.has("src/example.ts", "head", 1), false);
    assert.strictEqual(index.has("src/example.ts", "base", 6), false);
  });

  test("keeps canonical old/new pairs for context, additions and deletions", () => {
    const index = buildReviewDiffAnchorIndex(diff);
    assert.deepStrictEqual(index.anchor("src/example.ts", "head", 2), {
      oldPosition: 2,
      newPosition: 2,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "base", 2), {
      oldPosition: 2,
      newPosition: 2,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "base", 3), {
      oldPosition: 3,
      newPosition: 0,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "head", 3), {
      oldPosition: 0,
      newPosition: 3,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "head", 5), {
      oldPosition: 4,
      newPosition: 5,
    });
  });

  test("keeps anchors when a hunk starts on line one", () => {
    const index = buildReviewDiffAnchorIndex([
      "diff --git a/src/first.ts b/src/first.ts",
      "--- a/src/first.ts",
      "+++ b/src/first.ts",
      "@@ -1,2 +1,2 @@",
      " first",
      "-old",
      "+new",
    ].join("\n"));
    assert.deepStrictEqual(index.lines("src/first.ts", "base"), [1, 2]);
    assert.deepStrictEqual(index.lines("src/first.ts", "head"), [1, 2]);
    assert.deepStrictEqual(index.anchor("src/first.ts", "head", 1), {
      oldPosition: 1,
      newPosition: 1,
    });
  });

  test("does not guess unknown paths or lines", () => {
    const index = buildReviewDiffAnchorIndex(diff);
    assert.strictEqual(index.has("src/missing.ts", "head", 3), false);
    assert.deepStrictEqual(index.lines("src/missing.ts", "base"), []);
    assert.strictEqual(index.anchor("src/example.ts", "head", 99), undefined);
  });
});
