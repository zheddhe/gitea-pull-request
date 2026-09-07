import * as assert from "assert";
import type { GiteaWorkflowJob } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import { CIExecutionDetailService } from "../../features/ci/services/ciExecutionDetailService";

const repoInfo = {
  key: "https://gitea.test:o/r",
  serverUrl: "https://gitea.test",
  owner: "o",
  repo: "r",
  label: "o/r",
} as RepoInfo;

function job(overrides: Partial<GiteaWorkflowJob> = {}): GiteaWorkflowJob {
  return {
    id: 11,
    run_id: 7,
    name: "Tests",
    status: "completed",
    conclusion: "success",
    started_at: "2026-09-07T10:00:00Z",
    completed_at: "2026-09-07T10:01:00Z",
    html_url: "https://gitea.test/o/r/actions/runs/7/jobs/11",
    runner_name: "runner",
    ...overrides,
  };
}

suite("CI execution detail service", () => {
  test("uses embedded structured steps without fetching job detail", async () => {
    let calls = 0;
    const service = new CIExecutionDetailService({
      async getWorkflowJob() {
        calls += 1;
        return job();
      },
    });

    const result = await service.resolveJobSteps(
      repoInfo,
      job({
        steps: [
          {
            number: 1,
            name: "Checkout",
            status: "completed",
            conclusion: "success",
            started_at: "2026-09-07T10:00:00Z",
            completed_at: "2026-09-07T10:00:10Z",
          },
        ],
      }),
    );

    assert.strictEqual(calls, 0);
    assert.strictEqual(result.availability, "available");
    assert.strictEqual(result.steps.length, 1);
  });

  test("fetches missing structured detail once and reuses the cache", async () => {
    let calls = 0;
    const service = new CIExecutionDetailService({
      async getWorkflowJob() {
        calls += 1;
        return job({
          steps: [
            {
              number: 1,
              name: "Checkout",
              status: "completed",
              conclusion: "success",
              started_at: "2026-09-07T10:00:00Z",
              completed_at: "2026-09-07T10:00:10Z",
            },
          ],
        });
      },
    });

    const source = job({ steps: undefined });
    const first = await service.resolveJobSteps(repoInfo, source);
    const second = await service.resolveJobSteps(repoInfo, source);

    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(second, first);
  });

  test("preserves unavailable detail instead of fabricating steps", async () => {
    const service = new CIExecutionDetailService({
      async getWorkflowJob() {
        return job({ steps: undefined });
      },
    });

    const result = await service.resolveJobSteps(repoInfo, job({ steps: undefined }));
    assert.deepStrictEqual(result, {
      availability: "unavailable",
      steps: [],
      rejectedCount: 0,
    });
  });

  test("run invalidation causes missing detail to be fetched again", async () => {
    let calls = 0;
    const service = new CIExecutionDetailService({
      async getWorkflowJob() {
        calls += 1;
        return job({ steps: [] });
      },
    });

    const source = job({ steps: undefined });
    await service.resolveJobSteps(repoInfo, source);
    service.invalidateRun(repoInfo, source.run_id);
    await service.resolveJobSteps(repoInfo, source);

    assert.strictEqual(calls, 2);
  });
});
