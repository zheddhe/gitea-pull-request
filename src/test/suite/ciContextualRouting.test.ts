import * as assert from "assert";
import type { GiteaWorkflowJob } from "../../api/types";
import { resolveContextualJob } from "../../commands/ciCommands";

suite("CI contextual routing", () => {
  test("routes directly when a known job id is supplied", () => {
    const jobs = [job(10, "build"), job(11, "test")];
    const result = resolveContextualJob(jobs, 11);
    assert.strictEqual(result.kind, "job");
    if (result.kind === "job") {
      assert.strictEqual(result.job.id, 11);
    }
  });

  test("does not fall back to a picker when a supplied job id is missing", () => {
    const result = resolveContextualJob([job(10, "build"), job(11, "test")], 99);
    assert.strictEqual(result.kind, "not-found");
  });

  test("routes a single-job aggregate directly", () => {
    const result = resolveContextualJob([job(10, "build")]);
    assert.strictEqual(result.kind, "job");
    if (result.kind === "job") {
      assert.strictEqual(result.job.id, 10);
    }
  });

  test("uses picker fallback only for an ambiguous multi-job aggregate", () => {
    const result = resolveContextualJob([job(10, "build"), job(11, "test")]);
    assert.strictEqual(result.kind, "ambiguous");
  });

  test("reports no target when the run has no jobs", () => {
    assert.strictEqual(resolveContextualJob([]).kind, "not-found");
  });
});

function job(id: number, name: string): GiteaWorkflowJob {
  return {
    id,
    run_id: 123,
    name,
    status: "completed",
    conclusion: "success",
    started_at: "",
    completed_at: "",
    html_url: `https://gitea.test/o/r/actions/runs/123/jobs/${id}`,
    runner_name: "",
  };
}
