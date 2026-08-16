import * as assert from "assert";
import {
  resolveBranchIdentity,
  type BranchRefSnapshot,
} from "../../features/pullRequests/services/branchCleanupService";

suite("BranchCleanupService identity resolution", () => {
  test("resolves exact local and origin remote head branches", () => {
    const refs: BranchRefSnapshot[] = [
      { name: "feature/work" },
      { name: "main" },
      { name: "origin/feature/work", remote: "origin" },
      { name: "origin/main", remote: "origin" },
    ];

    const result = resolveBranchIdentity(
      refs,
      { name: "feature/work", upstream: { name: "origin/feature/work", remote: "origin" } },
      "feature/work",
      "main",
    );

    assert.strictEqual(result.localHead, "feature/work");
    assert.strictEqual(result.localHeadCheckedOut, true);
    assert.strictEqual(result.remoteHead?.remote, "origin");
    assert.strictEqual(result.remoteHead?.branch, "feature/work");
    assert.strictEqual(result.localBase, "main");
  });

  test("keeps local alias independent from PR remote branch name", () => {
    const refs: BranchRefSnapshot[] = [
      { name: "my-local-work" },
      { name: "origin/feature/work", remote: "origin" },
      { name: "origin/main", remote: "origin" },
    ];

    const result = resolveBranchIdentity(
      refs,
      {
        name: "my-local-work",
        upstream: { name: "origin/feature/work", remote: "origin" },
      },
      "feature/work",
      "main",
    );

    assert.strictEqual(result.localHead, "my-local-work");
    assert.strictEqual(result.localHeadCheckedOut, true);
    assert.strictEqual(result.remoteHead?.branch, "feature/work");
  });

  test("does not invent a local branch when only remote head exists", () => {
    const result = resolveBranchIdentity(
      [{ name: "upstream/topic", remote: "upstream" }],
      { name: "main" },
      "topic",
      "main",
    );

    assert.strictEqual(result.localHead, undefined);
    assert.strictEqual(result.localHeadCheckedOut, false);
    assert.strictEqual(result.remoteHead?.remote, "upstream");
    assert.strictEqual(result.remoteHead?.branch, "topic");
  });

  test("prefers origin when the same remote branch exists on several remotes", () => {
    const result = resolveBranchIdentity(
      [
        { name: "upstream/topic", remote: "upstream" },
        { name: "origin/topic", remote: "origin" },
      ],
      undefined,
      "topic",
      "main",
    );

    assert.strictEqual(result.remoteHead?.remote, "origin");
  });
});
