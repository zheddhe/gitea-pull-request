import * as assert from "assert";
import type { GiteaWorkflowJob, GiteaWorkflowRun } from "../../api/types";
import {
  canCancelWorkflow,
  canRerunJob,
  canRerunWorkflow,
} from "../../commands/ciCommands";

function run(overrides: Partial<GiteaWorkflowRun> = {}): GiteaWorkflowRun {
  return {
    id: 42,
    name: "CI",
    display_title: "CI",
    status: "completed",
    conclusion: "success",
    workflow_id: "ci.yml",
    run_number: 1,
    event: "push",
    run_started_at: "2026-09-07T10:00:00Z",
    created_at: "2026-09-07T10:00:00Z",
    updated_at: "2026-09-07T10:01:00Z",
    html_url: "https://gitea.test/o/r/actions/runs/42",
    head_branch: "main",
    head_sha: "abc",
    head_commit: { message: "CI", author: { name: "Dev" } },
    repository: { default_branch: "main" } as GiteaWorkflowRun["repository"],
    jobs_url: "https://gitea.test/api/jobs",
    ...overrides,
  };
}

function job(overrides: Partial<GiteaWorkflowJob> = {}): GiteaWorkflowJob {
  return {
    id: 7,
    run_id: 42,
    name: "Tests",
    status: "completed",
    conclusion: "failure",
    started_at: "2026-09-07T10:00:00Z",
    completed_at: "2026-09-07T10:01:00Z",
    html_url: "https://gitea.test/o/r/actions/runs/42/jobs/7",
    runner_name: "runner",
    ...overrides,
  };
}

suite("CI action ownership", () => {
  test("allows run rerun only after terminal execution", () => {
    assert.strictEqual(canRerunWorkflow(run()), true);
    assert.strictEqual(
      canRerunWorkflow(run({ status: "running", conclusion: "" })),
      false,
    );
    assert.strictEqual(
      canRerunWorkflow(
        run({
          status: "unexpected" as unknown as GiteaWorkflowRun["status"],
          conclusion: "",
        }),
      ),
      false,
    );
  });

  test("allows run cancellation only while active", () => {
    assert.strictEqual(
      canCancelWorkflow(run({ status: "running", conclusion: "" })),
      true,
    );
    assert.strictEqual(canCancelWorkflow(run()), false);
  });

  test("allows job rerun only for terminal jobs", () => {
    assert.strictEqual(canRerunJob({ job: job() } as never), true);
    assert.strictEqual(
      canRerunJob({ job: job({ status: "running", conclusion: "" }) } as never),
      false,
    );
    assert.strictEqual(
      canRerunJob({ job: job({ status: "unexpected", conclusion: "" }) } as never),
      false,
    );
  });
});
