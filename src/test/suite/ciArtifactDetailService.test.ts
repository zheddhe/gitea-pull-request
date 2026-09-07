import * as assert from "assert";
import type { RepoInfo } from "../../context/repoManager";
import { CIArtifactDetailService } from "../../features/ci/services/ciArtifactDetailService";

const repoInfo = {
  key: "https://gitea.test:o/r",
  serverUrl: "https://gitea.test",
  owner: "o",
  repo: "r",
  label: "o/r",
} as RepoInfo;

suite("CI artifact detail service", () => {
  test("loads artifacts lazily and caches normalized metadata", async () => {
    let calls = 0;
    const service = new CIArtifactDetailService({
      async listWorkflowArtifacts() {
        calls += 1;
        return {
          total_count: 1,
          artifacts: [
            {
              id: 9,
              name: "coverage-html",
              size_in_bytes: 2048,
              expired: false,
            },
          ],
        };
      },
    });

    const first = await service.resolveRunArtifacts(repoInfo, 7);
    const second = await service.resolveRunArtifacts(repoInfo, 7);

    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(first.availability, "available");
    assert.strictEqual(first.artifacts[0]?.name, "coverage-html");
  });

  test("run invalidation causes artifact metadata to refresh", async () => {
    let calls = 0;
    const service = new CIArtifactDetailService({
      async listWorkflowArtifacts() {
        calls += 1;
        return { artifacts: [] };
      },
    });

    await service.resolveRunArtifacts(repoInfo, 7);
    service.invalidateRun(repoInfo, 7);
    await service.resolveRunArtifacts(repoInfo, 7);

    assert.strictEqual(calls, 2);
  });

  test("preserves unavailable payload shape instead of fabricating artifacts", async () => {
    const service = new CIArtifactDetailService({
      async listWorkflowArtifacts() {
        return {};
      },
    });

    const result = await service.resolveRunArtifacts(repoInfo, 7);
    assert.deepStrictEqual(result, {
      availability: "unavailable",
      artifacts: [],
      rejectedCount: 0,
    });
  });
});
