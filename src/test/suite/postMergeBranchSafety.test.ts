import * as assert from "assert";
import type { RepoInfo } from "../../context/repoManager";
import type { BranchIdentity } from "../../features/pullRequests/services/branchCleanupService";
import {
  BranchSyncAnalyzerService,
  classifyRemoteHead,
  localCleanupSafetyMessage,
  remoteCleanupSafetyMessage,
  type BranchSyncGit,
} from "../../features/pullRequests/services/branchSyncAnalyzerService";

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

suite("post-merge branch safety", () => {
  test("classifies remote graph relationships against the merged PR head", () => {
    assert.strictEqual(classifyRemoteHead(0, 0), "in-sync");
    assert.strictEqual(classifyRemoteHead(2, 0), "remote-ahead");
    assert.strictEqual(classifyRemoteHead(0, 2), "remote-behind");
    assert.strictEqual(classifyRemoteHead(2, 1), "diverged");
  });

  test("detects local-only commits against the authoritative PR head even after merge", async () => {
    const git: BranchSyncGit = {
      resolveRef: async () => "abc123",
      revListLeftRightCount: async (_repo, left, right) => {
        assert.strictEqual(left, "feature/work");
        assert.strictEqual(right, "abc123");
        return { localOnly: 1, remoteOnly: 0 };
      },
    };

    const result = await new BranchSyncAnalyzerService(git).analyzeLocalAgainstPrHead(
      repoInfo,
      identity(),
      "abc123",
    );

    assert.strictEqual(result.state, "local-ahead");
    assert.strictEqual(result.localOnly, 1);
    assert.match(localCleanupSafetyMessage(result) ?? "", /not part of the merged pull request/);
    assert.match(localCleanupSafetyMessage(result) ?? "", /will be kept/);
  });

  test("treats a local branch contained in the merged PR head as safe", async () => {
    const git: BranchSyncGit = {
      resolveRef: async () => "abc123",
      revListLeftRightCount: async () => ({ localOnly: 0, remoteOnly: 2 }),
    };

    const result = await new BranchSyncAnalyzerService(git).analyzeLocalAgainstPrHead(
      repoInfo,
      identity(),
      "abc123",
    );

    assert.strictEqual(result.state, "local-behind");
    assert.strictEqual(localCleanupSafetyMessage(result), undefined);
  });

  test("detects remote commits added after the PR head was merged", async () => {
    const git: BranchSyncGit = {
      resolveRef: async () => "new456",
      revListLeftRightCount: async (_repo, left, right) => {
        assert.strictEqual(left, "origin/feature/work");
        assert.strictEqual(right, "abc123");
        return { localOnly: 2, remoteOnly: 0 };
      },
    };

    const result = await new BranchSyncAnalyzerService(git).analyzeRemoteAgainstPrHead(
      repoInfo,
      identity(),
      "abc123",
    );

    assert.strictEqual(result.state, "remote-ahead");
    assert.strictEqual(result.remoteOnly, 2);
    assert.match(remoteCleanupSafetyMessage(result) ?? "", /added after the PR head/);
    assert.match(remoteCleanupSafetyMessage(result) ?? "", /will be kept/);
  });

  test("reports an absent remote without treating it as unsafe deletion", async () => {
    const git: BranchSyncGit = {
      resolveRef: async () => "abc123",
      revListLeftRightCount: async () => ({ localOnly: 0, remoteOnly: 0 }),
    };

    const result = await new BranchSyncAnalyzerService(git).analyzeRemoteAgainstPrHead(
      repoInfo,
      identity({ remoteHead: undefined }),
      "abc123",
    );

    assert.strictEqual(result.state, "absent");
    assert.strictEqual(remoteCleanupSafetyMessage(result), undefined);
  });

  test("never presents an unverifiable local graph as safe", async () => {
    const git: BranchSyncGit = {
      resolveRef: async () => "abc123",
      revListLeftRightCount: async () => {
        throw new Error("cannot inspect commit graph");
      },
    };

    const result = await new BranchSyncAnalyzerService(git).analyzeLocalAgainstPrHead(
      repoInfo,
      identity(),
      "abc123",
    );

    assert.strictEqual(result.state, "unknown");
    assert.match(localCleanupSafetyMessage(result) ?? "", /could not be verified/);
    assert.match(localCleanupSafetyMessage(result) ?? "", /will be kept/);
  });
});
