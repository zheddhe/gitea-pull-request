import * as assert from "assert";
import {
  fingerprintPatch,
  reconcileReviewedFiles,
  type ReviewedFileRecord,
} from "../../features/pullRequests/domain/reviewedFileState";

suite("Reviewed file state", () => {
  const base: ReviewedFileRecord = {
    repositoryKey: "repo-a",
    pullRequestNumber: 31,
    filename: "src/a.ts",
    reviewedAtHead: "head-1",
    fingerprint: fingerprintPatch("@@ -1 +1 @@\n-old\n+new"),
  };

  test("restores reviewed state on the same PR head", () => {
    const result = reconcileReviewedFiles(
      [base],
      "repo-a",
      31,
      "head-1",
      [{ filename: "src/a.ts" }],
    );
    assert.deepStrictEqual(result, [base]);
  });

  test("preserves reviewed state across heads only for an identical reliable fingerprint", () => {
    const result = reconcileReviewedFiles(
      [base],
      "repo-a",
      31,
      "head-2",
      [{ filename: "src/a.ts", fingerprint: base.fingerprint }],
    );
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].reviewedAtHead, "head-2");
  });

  test("invalidates a reviewed file when its patch changes", () => {
    const result = reconcileReviewedFiles(
      [base],
      "repo-a",
      31,
      "head-2",
      [{ filename: "src/a.ts", fingerprint: fingerprintPatch("different patch") }],
    );
    assert.deepStrictEqual(result, []);
  });

  test("invalidates conservatively when no cross-head fingerprint is available", () => {
    const result = reconcileReviewedFiles(
      [{ ...base, fingerprint: undefined }],
      "repo-a",
      31,
      "head-2",
      [{ filename: "src/a.ts" }],
    );
    assert.deepStrictEqual(result, []);
  });

  test("does not leak records across repositories or pull requests", () => {
    assert.deepStrictEqual(
      reconcileReviewedFiles([base], "repo-b", 31, "head-1", [
        { filename: "src/a.ts", fingerprint: base.fingerprint },
      ]),
      [],
    );
    assert.deepStrictEqual(
      reconcileReviewedFiles([base], "repo-a", 32, "head-1", [
        { filename: "src/a.ts", fingerprint: base.fingerprint },
      ]),
      [],
    );
  });
});
