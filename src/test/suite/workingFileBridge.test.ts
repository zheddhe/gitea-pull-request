import * as assert from "assert";
import {
  evaluateWorkingFileBridge,
  type WorkingRepositoryCandidate,
} from "../../features/pullRequests/domain/workingFileBridge";

suite("Working file bridge", () => {
  const source: WorkingRepositoryCandidate = {
    key: "https://gitea.example|alice/repo",
    serverUrl: "https://gitea.example",
    label: "alice/repo",
    rootPath: "/workspace/repo",
    currentBranch: "feature/review",
  };

  test("allows the source workspace only when the PR source branch is already checked out", () => {
    const result = evaluateWorkingFileBridge(
      "https://gitea.example/",
      "alice/repo",
      "feature/review",
      [source],
    );

    assert.strictEqual(result.kind, "available");
    if (result.kind === "available") {
      assert.strictEqual(result.repository.rootPath, "/workspace/repo");
    }
  });

  test("rejects a workspace on another branch without switching it", () => {
    const result = evaluateWorkingFileBridge(
      "https://gitea.example",
      "alice/repo",
      "feature/review",
      [{ ...source, currentBranch: "main" }],
    );

    assert.deepStrictEqual(result, {
      kind: "unavailable",
      reason: "sourceBranchNotCheckedOut",
      repository: { ...source, currentBranch: "main" },
    });
  });

  test("rejects a base repository workspace when the PR comes from a fork", () => {
    const result = evaluateWorkingFileBridge(
      "https://gitea.example",
      "bob/repo",
      "feature/review",
      [{ ...source, label: "alice/repo" }],
    );

    assert.deepStrictEqual(result, {
      kind: "unavailable",
      reason: "sourceRepositoryNotInWorkspace",
    });
  });

  test("does not match an identically named repository from another server", () => {
    const result = evaluateWorkingFileBridge(
      "https://gitea.example",
      "alice/repo",
      "feature/review",
      [{ ...source, serverUrl: "https://other.example" }],
    );

    assert.deepStrictEqual(result, {
      kind: "unavailable",
      reason: "sourceRepositoryNotInWorkspace",
    });
  });
});
