import * as assert from "assert";
import type { RepoInfo } from "../../context/repoManager";
import type { BranchIdentity } from "../../features/pullRequests/services/branchCleanupService";
import type { BranchSyncDiagnostic } from "../../features/pullRequests/services/branchSyncAnalyzerService";
import {
  PreMergeBranchSyncService,
  type PreMergeBranchIdentityDiscovery,
  type PreMergeBranchSyncAnalysis,
} from "../../features/pullRequests/services/preMergeBranchSyncService";

const repoInfo = {
  key: "repo",
  label: "repo",
  rootPath: "/tmp/repo",
} as RepoInfo;

const branchIdentity: BranchIdentity = {
  prHead: "feature/work",
  base: "main",
  localHead: "feature/work",
  localHeadCheckedOut: false,
  remoteHead: {
    remote: "origin",
    branch: "feature/work",
    refName: "origin/feature/work",
  },
};

function diagnostic(
  state: BranchSyncDiagnostic["state"],
  localOnly = 0,
  remoteOnly = 0,
): BranchSyncDiagnostic {
  return {
    state,
    localOnly,
    remoteOnly,
    localRef: "feature/work",
    remoteRef: "origin/feature/work",
    remoteMatchesPrHead: true,
  };
}

suite("PreMergeBranchSyncService", () => {
  test("uses PR branch refs and authoritative head SHA for analysis", async () => {
    const calls: string[] = [];
    const discovery: PreMergeBranchIdentityDiscovery = {
      discover: async (_repo, head, base) => {
        calls.push(`discover:${head}:${base}`);
        return branchIdentity;
      },
    };
    const analysis: PreMergeBranchSyncAnalysis = {
      analyze: async (_repo, identity, sha) => {
        assert.strictEqual(identity, branchIdentity);
        calls.push(`analyze:${sha}`);
        return diagnostic("in-sync");
      },
    };

    const result = await new PreMergeBranchSyncService(discovery, analysis).evaluate(
      repoInfo,
      {
        head: { ref: "feature/work", sha: "abc123" },
        base: { ref: "main" },
      },
    );

    assert.deepStrictEqual(calls, [
      "discover:feature/work:main",
      "analyze:abc123",
    ]);
    assert.strictEqual(result.warning, undefined);
  });

  test("returns an advisory for local-only commits without blocking the result", async () => {
    const service = new PreMergeBranchSyncService(
      { discover: async () => branchIdentity },
      { analyze: async () => diagnostic("local-ahead", 2, 0) },
    );

    const result = await service.evaluate(repoInfo, {
      head: { ref: "feature/work", sha: "abc123" },
      base: { ref: "main" },
    });

    assert.strictEqual(result.diagnostic.state, "local-ahead");
    assert.match(result.warning ?? "", /2 local commits/);
  });

  test("preserves unknown as an explicit advisory instead of claiming safety", async () => {
    const service = new PreMergeBranchSyncService(
      { discover: async () => branchIdentity },
      {
        analyze: async () => ({
          ...diagnostic("unknown"),
          reason: "remote head could not be verified",
        }),
      },
    );

    const result = await service.evaluate(repoInfo, {
      head: { ref: "feature/work", sha: "abc123" },
      base: { ref: "main" },
    });

    assert.match(result.warning ?? "", /could not be verified/i);
    assert.match(result.warning ?? "", /remote head could not be verified/);
  });
});
