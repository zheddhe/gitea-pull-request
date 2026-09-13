import * as assert from "assert";
import type { RepoInfo } from "../../context/repoManager";
import {
  BranchSyncAnalyzerService,
  classifyBranchSync,
  parseLeftRightCount,
  preMergeBranchSyncWarning,
  type BranchSyncDiagnostic,
  type BranchSyncGit,
} from "../../features/pullRequests/services/branchSyncAnalyzerService";
import type { BranchIdentity } from "../../features/pullRequests/services/branchCleanupService";

const repoInfo = {
  key: "repo",
  label: "repo",
  rootPath: "/tmp/repo",
} as RepoInfo;

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
    currentBranch: "main",
    ...overrides,
  };
}

function git(
  localOnly: number,
  remoteOnly: number,
  remoteSha = "abc123",
): BranchSyncGit {
  return {
    resolveRef: async () => remoteSha,
    revListLeftRightCount: async () => ({ localOnly, remoteOnly }),
  };
}

function diagnostic(
  state: BranchSyncDiagnostic["state"],
  localOnly = 0,
  remoteOnly = 0,
  reason?: string,
): BranchSyncDiagnostic {
  return { state, localOnly, remoteOnly, reason };
}

suite("BranchSyncAnalyzerService", () => {
  test("classifies graph relationships from left/right counts", () => {
    assert.strictEqual(classifyBranchSync(0, 0), "in-sync");
    assert.strictEqual(classifyBranchSync(0, 2), "local-behind");
    assert.strictEqual(classifyBranchSync(3, 0), "local-ahead");
    assert.strictEqual(classifyBranchSync(2, 1), "diverged");
  });

  test("parses git rev-list left/right counts", () => {
    assert.deepStrictEqual(parseLeftRightCount("2\t1\n"), {
      localOnly: 2,
      remoteOnly: 1,
    });
    assert.throws(() => parseLeftRightCount("unexpected"));
  });

  test("reports local commits that are ahead of the authoritative PR head", async () => {
    const result = await new BranchSyncAnalyzerService(git(2, 0)).analyze(
      repoInfo,
      identity(),
      "abc123",
    );
    assert.strictEqual(result.state, "local-ahead");
    assert.strictEqual(result.localOnly, 2);
    assert.strictEqual(result.remoteOnly, 0);
    assert.strictEqual(result.remoteMatchesPrHead, true);
  });

  test("distinguishes a merely behind local branch from local-only work", async () => {
    const result = await new BranchSyncAnalyzerService(git(0, 3)).analyze(
      repoInfo,
      identity(),
      "abc123",
    );
    assert.strictEqual(result.state, "local-behind");
    assert.strictEqual(result.localOnly, 0);
    assert.strictEqual(result.remoteOnly, 3);
  });

  test("reports divergence with both unique commit counts", async () => {
    const result = await new BranchSyncAnalyzerService(git(2, 1)).analyze(
      repoInfo,
      identity(),
      "abc123",
    );
    assert.strictEqual(result.state, "diverged");
    assert.strictEqual(result.localOnly, 2);
    assert.strictEqual(result.remoteOnly, 1);
  });

  test("degrades to unknown when branch mapping is incomplete", async () => {
    const result = await new BranchSyncAnalyzerService(git(0, 0)).analyze(
      repoInfo,
      identity({ localHead: undefined }),
      "abc123",
    );
    assert.strictEqual(result.state, "unknown");
    assert.match(result.reason ?? "", /Local source branch/);
  });

  test("does not trust a stale remote tracking ref that differs from the PR head", async () => {
    const result = await new BranchSyncAnalyzerService(
      git(0, 0, "stale456"),
    ).analyze(repoInfo, identity(), "abc123");
    assert.strictEqual(result.state, "unknown");
    assert.strictEqual(result.remoteMatchesPrHead, false);
    assert.match(result.reason ?? "", /authoritative pull request head/);
  });

  test("analysis failure degrades to unknown instead of claiming safety", async () => {
    const failingGit: BranchSyncGit = {
      resolveRef: async () => "abc123",
      revListLeftRightCount: async () => {
        throw new Error("cannot inspect graph");
      },
    };
    const result = await new BranchSyncAnalyzerService(failingGit).analyze(
      repoInfo,
      identity(),
      "abc123",
    );
    assert.strictEqual(result.state, "unknown");
    assert.match(result.reason ?? "", /cannot inspect graph/);
  });
});

suite("preMergeBranchSyncWarning", () => {
  test("does not add an advisory for synchronized or merely behind local branches", () => {
    assert.strictEqual(preMergeBranchSyncWarning(diagnostic("in-sync")), undefined);
    assert.strictEqual(
      preMergeBranchSyncWarning(diagnostic("local-behind", 0, 2)),
      undefined,
    );
  });

  test("warns when local commits are not part of the remote pull request", () => {
    const warning = preMergeBranchSyncWarning(diagnostic("local-ahead", 2, 0));
    assert.match(warning ?? "", /2 local commits/);
    assert.match(warning ?? "", /not part of this pull request/);
  });

  test("reports both unique commit counts for divergence", () => {
    const warning = preMergeBranchSyncWarning(diagnostic("diverged", 2, 1));
    assert.match(warning ?? "", /2 local-only/);
    assert.match(warning ?? "", /1 remote-only/);
  });

  test("never presents an unverifiable state as synchronized", () => {
    const warning = preMergeBranchSyncWarning(
      diagnostic("unknown", 0, 0, "source branch cannot be mapped"),
    );
    assert.match(warning ?? "", /could not be verified/i);
    assert.match(warning ?? "", /source branch cannot be mapped/);
  });
});
