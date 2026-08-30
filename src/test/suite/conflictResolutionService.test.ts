import * as assert from "assert";
import {
  classifySourceSynchronization,
  executeConflictResolutionPreparation,
  executeSourceBranchPreparation,
  type ConflictResolutionOperations,
  type ConflictResolutionPlan,
  type SourceBranchPreparationOperations,
} from "../../features/pullRequests/services/conflictResolutionService";

const plan: ConflictResolutionPlan = {
  sourceBranch: "feature/conflict",
  sourceSha: "1111111111111111111111111111111111111111",
  sourceRemote: "origin",
  sourceRemoteRef: "origin/feature/conflict",
  baseBranch: "develop",
  baseRemote: "origin",
  baseRemoteRef: "origin/develop",
};

suite("ConflictResolutionService", () => {
  test("refuses preparation when the working tree is dirty", async () => {
    const calls: string[] = [];
    const operations = fakeOperations(calls, {
      inspect: async () => ({
        dirty: true,
        mergeInProgress: false,
        currentBranch: "feature/conflict",
      }),
    });

    await assert.rejects(
      () => executeConflictResolutionPreparation(plan, operations),
      /working tree contains local changes/i,
    );
    assert.deepStrictEqual(calls, ["inspect"]);
  });

  test("refuses preparation when another merge is already in progress", async () => {
    const calls: string[] = [];
    const operations = fakeOperations(calls, {
      inspect: async () => ({
        dirty: false,
        mergeInProgress: true,
        currentBranch: "feature/conflict",
      }),
    });

    await assert.rejects(
      () => executeConflictResolutionPreparation(plan, operations),
      /merge is already in progress/i,
    );
    assert.deepStrictEqual(calls, ["inspect"]);
  });

  test("fetches before checkout and merges the fresh remote base", async () => {
    const calls: string[] = [];
    const operations = fakeOperations(calls);

    const result = await executeConflictResolutionPreparation(plan, operations);

    assert.deepStrictEqual(result, {
      kind: "clean",
      sourceBranch: "feature/conflict",
      baseRef: "origin/develop",
    });
    assert.deepStrictEqual(calls, [
      "inspect",
      "fetch:origin",
      "checkout:origin/feature/conflict",
      "merge:origin/develop",
    ]);
  });

  test("fetches source and base remotes independently for fork pull requests", async () => {
    const calls: string[] = [];
    const forkPlan: ConflictResolutionPlan = {
      ...plan,
      sourceRemote: "contributor",
      sourceRemoteRef: "contributor/feature/conflict",
    };
    const operations = fakeOperations(calls);

    await executeConflictResolutionPreparation(forkPlan, operations);

    assert.deepStrictEqual(calls, [
      "inspect",
      "fetch:contributor",
      "fetch:origin",
      "checkout:contributor/feature/conflict",
      "merge:origin/develop",
    ]);
  });

  test("preserves a conflict result returned by Git", async () => {
    const calls: string[] = [];
    const operations = fakeOperations(calls, {
      mergeBase: async (resolvedPlan) => ({
        kind: "conflicts",
        sourceBranch: resolvedPlan.sourceBranch,
        baseRef: resolvedPlan.baseRemoteRef,
        conflictedFiles: ["src/a.ts", "src/b.ts"],
      }),
    });

    const result = await executeConflictResolutionPreparation(plan, operations);

    assert.strictEqual(result.kind, "conflicts");
    if (result.kind === "conflicts") {
      assert.deepStrictEqual(result.conflictedFiles, ["src/a.ts", "src/b.ts"]);
    }
  });

  test("source-only preparation refuses a dirty working tree before fetch", async () => {
    const calls: string[] = [];
    const operations = fakeSourceOperations(calls, {
      inspect: async () => ({
        dirty: true,
        mergeInProgress: false,
        currentBranch: "main",
      }),
    });

    await assert.rejects(
      () => executeSourceBranchPreparation(plan, operations),
      /working tree contains local changes/i,
    );
    assert.deepStrictEqual(calls, ["inspect"]);
  });

  test("source-only preparation refuses an existing merge before fetch", async () => {
    const calls: string[] = [];
    const operations = fakeSourceOperations(calls, {
      inspect: async () => ({
        dirty: false,
        mergeInProgress: true,
        currentBranch: "main",
      }),
    });

    await assert.rejects(
      () => executeSourceBranchPreparation(plan, operations),
      /merge is already in progress/i,
    );
    assert.deepStrictEqual(calls, ["inspect"]);
  });

  test("source-only preparation fetches only the source remote before checkout", async () => {
    const calls: string[] = [];
    const forkPlan: ConflictResolutionPlan = {
      ...plan,
      sourceRemote: "contributor",
      sourceRemoteRef: "contributor/feature/conflict",
    };
    const operations = fakeSourceOperations(calls);

    await executeSourceBranchPreparation(forkPlan, operations);

    assert.deepStrictEqual(calls, [
      "inspect",
      "fetch:contributor",
      "checkout:contributor/feature/conflict",
    ]);
  });

  test("keeps an exact local pull request source unchanged", () => {
    assert.strictEqual(
      classifySourceSynchronization("abc", "abc", true),
      "current",
    );
  });

  test("allows only a safe fast-forward for a stale local source", () => {
    assert.strictEqual(
      classifySourceSynchronization("old", "new", true),
      "fastForward",
    );
  });

  test("refuses a local source that has diverged from the pull request head", () => {
    assert.strictEqual(
      classifySourceSynchronization("local", "remote", false),
      "diverged",
    );
  });
});

function fakeOperations(
  calls: string[],
  overrides: Partial<ConflictResolutionOperations> = {},
): ConflictResolutionOperations {
  return {
    inspect: async () => {
      calls.push("inspect");
      return {
        dirty: false,
        mergeInProgress: false,
        currentBranch: "main",
      };
    },
    fetch: async (remote) => {
      calls.push(`fetch:${remote}`);
    },
    checkoutSource: async (resolvedPlan) => {
      calls.push(`checkout:${resolvedPlan.sourceRemoteRef}`);
    },
    mergeBase: async (resolvedPlan) => {
      calls.push(`merge:${resolvedPlan.baseRemoteRef}`);
      return {
        kind: "clean",
        sourceBranch: resolvedPlan.sourceBranch,
        baseRef: resolvedPlan.baseRemoteRef,
      };
    },
    abortMerge: async () => {
      calls.push("abort");
    },
    ...wrapOverrides(calls, overrides),
  };
}

function fakeSourceOperations(
  calls: string[],
  overrides: Partial<SourceBranchPreparationOperations> = {},
): SourceBranchPreparationOperations {
  return {
    inspect: async () => {
      calls.push("inspect");
      return {
        dirty: false,
        mergeInProgress: false,
        currentBranch: "main",
      };
    },
    fetch: async (remote) => {
      calls.push(`fetch:${remote}`);
    },
    checkoutSource: async (resolvedPlan) => {
      calls.push(`checkout:${resolvedPlan.sourceRemoteRef}`);
    },
    ...wrapSourceOverrides(calls, overrides),
  };
}

function wrapOverrides(
  calls: string[],
  overrides: Partial<ConflictResolutionOperations>,
): Partial<ConflictResolutionOperations> {
  const wrapped: Partial<ConflictResolutionOperations> = { ...overrides };
  if (overrides.inspect) {
    wrapped.inspect = async () => {
      calls.push("inspect");
      return overrides.inspect!();
    };
  }
  if (overrides.mergeBase) {
    wrapped.mergeBase = async (resolvedPlan) => {
      calls.push(`merge:${resolvedPlan.baseRemoteRef}`);
      return overrides.mergeBase!(resolvedPlan);
    };
  }
  return wrapped;
}

function wrapSourceOverrides(
  calls: string[],
  overrides: Partial<SourceBranchPreparationOperations>,
): Partial<SourceBranchPreparationOperations> {
  const wrapped: Partial<SourceBranchPreparationOperations> = { ...overrides };
  if (overrides.inspect) {
    wrapped.inspect = async () => {
      calls.push("inspect");
      return overrides.inspect!();
    };
  }
  return wrapped;
}
