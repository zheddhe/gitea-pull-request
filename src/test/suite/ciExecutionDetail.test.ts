import * as assert from "assert";
import {
  normalizeArtifactDetails,
  normalizeStepDetails,
} from "../../features/ci/domain/ciExecutionDetail";

suite("CI execution detail contracts", () => {
  test("distinguishes unavailable artifact data from an available empty list", () => {
    assert.deepStrictEqual(normalizeArtifactDetails(undefined), {
      availability: "unavailable",
      artifacts: [],
      rejectedCount: 0,
    });
    assert.deepStrictEqual(normalizeArtifactDetails([]), {
      availability: "available",
      artifacts: [],
      rejectedCount: 0,
    });
  });

  test("keeps authoritative artifact metadata and rejects synthetic identities", () => {
    const result = normalizeArtifactDetails([
      {
        id: 42,
        name: "coverage",
        size_in_bytes: 1024,
        expired: false,
        expires_at: "2026-09-10T12:00:00Z",
        archive_download_url: "https://gitea.test/api/v1/repos/o/r/actions/artifacts/42/zip",
      },
      { id: 43, name: "   " },
      { id: 0, name: "invalid-id" },
    ]);

    assert.strictEqual(result.availability, "available");
    assert.strictEqual(result.rejectedCount, 2);
    assert.deepStrictEqual(result.artifacts, [
      {
        id: 42,
        name: "coverage",
        sizeInBytes: 1024,
        expired: false,
        expiresAt: "2026-09-10T12:00:00Z",
        createdAt: undefined,
        updatedAt: undefined,
        downloadUrl: "https://gitea.test/api/v1/repos/o/r/actions/artifacts/42/zip",
      },
    ]);
  });

  test("projects structured steps only from authoritative fields", () => {
    const result = normalizeStepDetails([
      {
        number: 2,
        name: "Test",
        status: "completed",
        conclusion: "success",
        started_at: "2026-09-07T10:01:00Z",
        completed_at: "2026-09-07T10:02:00Z",
      },
      {
        number: 1,
        name: "Checkout",
        status: "completed",
        conclusion: "success",
        started_at: "invalid-time",
      },
      { number: 3, name: "" },
    ]);

    assert.strictEqual(result.availability, "available");
    assert.strictEqual(result.rejectedCount, 1);
    assert.deepStrictEqual(result.steps, [
      {
        number: 1,
        name: "Checkout",
        status: "completed",
        conclusion: "success",
        startedAt: undefined,
        completedAt: undefined,
      },
      {
        number: 2,
        name: "Test",
        status: "completed",
        conclusion: "success",
        startedAt: "2026-09-07T10:01:00Z",
        completedAt: "2026-09-07T10:02:00Z",
      },
    ]);
  });

  test("never fabricates steps when Gitea supplied no structured step array", () => {
    assert.deepStrictEqual(normalizeStepDetails(undefined), {
      availability: "unavailable",
      steps: [],
      rejectedCount: 0,
    });
  });
});
