import * as assert from "assert";
import {
  executeBranchCleanupPlan,
  planBranchCleanup,
  resolveBranchIdentity,
  type BranchCleanupOperations,
  type BranchCleanupPlan,
  type BranchIdentity,
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
      {
        name: "feature/work",
        upstream: { name: "origin/feature/work", remote: "origin" },
      },
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

suite("BranchCleanupService cleanup planning", () => {
  function identity(overrides: Partial<BranchIdentity> = {}): BranchIdentity {
    return {
      prHead: "feature/work",
      base: "main",
      localHead: "feature/work",
      localHeadCheckedOut: false,
      remoteHead: {
        remote: "origin",
        branch: "feature/work",
        refName: "origin/feature/work",
      },
      localBase: "main",
      remoteBase: {
        remote: "origin",
        branch: "main",
        refName: "origin/main",
      },
      currentBranch: "main",
      ...overrides,
    };
  }

  test("requires checkout before deleting the checked-out local head", () => {
    const plan = planBranchCleanup(
      identity({ currentBranch: "feature/work", localHeadCheckedOut: true }),
    );

    assert.strictEqual(plan.canDeleteLocal, true);
    assert.strictEqual(plan.checkoutBaseRequired, true);
    assert.strictEqual(plan.checkoutBase, "main");
  });

  test("does not require checkout when deleting a non-current local head", () => {
    const plan = planBranchCleanup(identity());

    assert.strictEqual(plan.canDeleteLocal, true);
    assert.strictEqual(plan.checkoutBaseRequired, false);
  });

  test("does not offer local deletion when the local head is absent", () => {
    const plan = planBranchCleanup(
      identity({ localHead: undefined, localHeadCheckedOut: false }),
    );

    assert.strictEqual(plan.canDeleteLocal, false);
    assert.strictEqual(plan.localBranch, undefined);
  });

  test("does not offer remote deletion when the remote head is absent", () => {
    const plan = planBranchCleanup(identity({ remoteHead: undefined }));

    assert.strictEqual(plan.canDeleteRemote, false);
    assert.strictEqual(plan.remoteBranch, undefined);
  });

  test("keeps local and remote cleanup names independent", () => {
    const plan = planBranchCleanup(
      identity({
        localHead: "my-local-work",
        remoteHead: {
          remote: "upstream",
          branch: "feature/work",
          refName: "upstream/feature/work",
        },
      }),
    );

    assert.strictEqual(plan.localBranch, "my-local-work");
    assert.strictEqual(plan.remoteBranch?.remote, "upstream");
    assert.strictEqual(plan.remoteBranch?.branch, "feature/work");
  });

  test("falls back to the PR base name when no local base branch exists", () => {
    const plan = planBranchCleanup(
      identity({ localBase: undefined, localHeadCheckedOut: true }),
    );

    assert.strictEqual(plan.checkoutBaseRequired, true);
    assert.strictEqual(plan.checkoutBase, "main");
  });
});

suite("BranchCleanupService cleanup execution", () => {
  function plan(overrides: Partial<BranchCleanupPlan> = {}): BranchCleanupPlan {
    return {
      localBranch: "local-work",
      remoteBranch: { remote: "origin", branch: "feature/work" },
      checkoutBaseRequired: true,
      checkoutBase: "main",
      canDeleteLocal: true,
      canDeleteRemote: true,
      ...overrides,
    };
  }

  function operations(calls: string[]): BranchCleanupOperations {
    return {
      checkoutBase: async (branch) => {
        calls.push(`checkout:${branch}`);
      },
      deleteLocal: async (branch) => {
        calls.push(`local:${branch}`);
      },
      deleteRemote: async (remote, branch) => {
        calls.push(`remote:${remote}/${branch}`);
      },
    };
  }

  test("checks out base before deleting a checked-out local branch", async () => {
    const calls: string[] = [];
    const result = await executeBranchCleanupPlan(
      plan(),
      { deleteLocal: true, deleteRemote: false },
      operations(calls),
    );

    assert.deepStrictEqual(calls, ["checkout:main", "local:local-work"]);
    assert.strictEqual(result.checkedOutBase, true);
    assert.strictEqual(result.localDeleted, true);
    assert.deepStrictEqual(result.errors, []);
  });

  test("checkout failure prevents local deletion", async () => {
    const calls: string[] = [];
    const ops = operations(calls);
    ops.checkoutBase = async (branch) => {
      calls.push(`checkout:${branch}`);
      throw new Error("dirty worktree");
    };

    const result = await executeBranchCleanupPlan(
      plan(),
      { deleteLocal: true, deleteRemote: false },
      ops,
    );

    assert.deepStrictEqual(calls, ["checkout:main"]);
    assert.strictEqual(result.localDeleted, false);
    assert.ok(result.errors[0]?.includes("dirty worktree"));
  });

  test("remote deletion remains independent when local checkout fails", async () => {
    const calls: string[] = [];
    const ops = operations(calls);
    ops.checkoutBase = async (branch) => {
      calls.push(`checkout:${branch}`);
      throw new Error("checkout failed");
    };

    const result = await executeBranchCleanupPlan(
      plan(),
      { deleteLocal: true, deleteRemote: true },
      ops,
    );

    assert.deepStrictEqual(calls, [
      "checkout:main",
      "remote:origin/feature/work",
    ]);
    assert.strictEqual(result.localDeleted, false);
    assert.strictEqual(result.remoteDeleted, true);
    assert.strictEqual(result.errors.length, 1);
  });

  test("supports remote-only cleanup", async () => {
    const calls: string[] = [];
    const result = await executeBranchCleanupPlan(
      plan({
        localBranch: undefined,
        canDeleteLocal: false,
        checkoutBaseRequired: false,
      }),
      { deleteLocal: false, deleteRemote: true },
      operations(calls),
    );

    assert.deepStrictEqual(calls, ["remote:origin/feature/work"]);
    assert.strictEqual(result.remoteDeleted, true);
    assert.strictEqual(result.localDeleted, false);
  });

  test("reports partial remote failure without undoing local cleanup", async () => {
    const calls: string[] = [];
    const ops = operations(calls);
    ops.deleteRemote = async (remote, branch) => {
      calls.push(`remote:${remote}/${branch}`);
      throw new Error("remote rejected deletion");
    };

    const result = await executeBranchCleanupPlan(
      plan({ checkoutBaseRequired: false }),
      { deleteLocal: true, deleteRemote: true },
      ops,
    );

    assert.deepStrictEqual(calls, [
      "local:local-work",
      "remote:origin/feature/work",
    ]);
    assert.strictEqual(result.localDeleted, true);
    assert.strictEqual(result.remoteDeleted, false);
    assert.ok(result.errors[0]?.includes("remote rejected deletion"));
  });
});
