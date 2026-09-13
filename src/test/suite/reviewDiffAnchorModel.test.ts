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

  test("keeps explicit hunk lines when no document bound is supplied", () => {
    const index = buildReviewDiffAnchorIndex(diff);
    assert.deepStrictEqual(index.lines("src/example.ts", "base"), [2, 3, 4, 5]);
    assert.deepStrictEqual(index.lines("src/example.ts", "head"), [2, 3, 4, 5, 6]);
  });

  test("maps unchanged lines before and after a hunk across the complete file", () => {
    const index = buildReviewDiffAnchorIndex(diff);
    assert.deepStrictEqual(index.lines("src/example.ts", "head", 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepStrictEqual(index.anchor("src/example.ts", "head", 1), {
      oldPosition: 1,
      newPosition: 1,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "head", 7), {
      oldPosition: 6,
      newPosition: 7,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "head", 9), {
      oldPosition: 8,
      newPosition: 9,
    });
    assert.deepStrictEqual(index.anchor("src/example.ts", "base", 8), {
      oldPosition: 8,
      newPosition: 9,
    });
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

  test("maps unchanged lines between multiple hunks using the accumulated delta", () => {
    const index = buildReviewDiffAnchorIndex([
      "diff --git a/src/multi.ts b/src/multi.ts",
      "--- a/src/multi.ts",
      "+++ b/src/multi.ts",
      "@@ -2,2 +2,3 @@",
      " two",
      "+inserted",
      " three",
      "@@ -7,2 +8,2 @@",
      " seven",
      "-old-eight",
      "+new-eight",
    ].join("\n"));

    assert.deepStrictEqual(index.anchor("src/multi.ts", "head", 6), {
      oldPosition: 5,
      newPosition: 6,
    });
    assert.deepStrictEqual(index.anchor("src/multi.ts", "base", 6), {
      oldPosition: 6,
      newPosition: 7,
    });
    assert.deepStrictEqual(index.anchor("src/multi.ts", "head", 10), {
      oldPosition: 9,
      newPosition: 10,
    });
  });

  test("handles zero-count insertion hunks without shifting the preceding line", () => {
    const index = buildReviewDiffAnchorIndex([
      "diff --git a/src/insert.ts b/src/insert.ts",
      "--- a/src/insert.ts",
      "+++ b/src/insert.ts",
      "@@ -3,0 +4,2 @@",
      "+new-four",
      "+new-five",
    ].join("\n"));

    assert.deepStrictEqual(index.anchor("src/insert.ts", "base", 3), {
      oldPosition: 3,
      newPosition: 3,
    });
    assert.deepStrictEqual(index.anchor("src/insert.ts", "head", 4), {
      oldPosition: 0,
      newPosition: 4,
    });
    assert.deepStrictEqual(index.anchor("src/insert.ts", "base", 4), {
      oldPosition: 4,
      newPosition: 6,
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

  test("does not guess unknown paths", () => {
    const index = buildReviewDiffAnchorIndex(diff);
    assert.strictEqual(index.has("src/missing.ts", "head", 3), false);
    assert.deepStrictEqual(index.lines("src/missing.ts", "base", 20), []);
    assert.strictEqual(index.anchor("src/missing.ts", "head", 99), undefined);
  });
});
