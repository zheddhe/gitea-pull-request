import * as assert from "assert";
import * as vscode from "vscode";
import type { GiteaWorkflowJob, GiteaWorkflowRun } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import {
  CIJobItem,
  CIRunItem,
  displayStatusForRun,
  runSecondaryMetadata,
} from "../../views/ciRunsProvider";

suite("CI run presentation", () => {
  const repoInfo: RepoInfo = {
    serverUrl: "https://gitea.example.test",
    owner: "owner",
    repo: "repo",
    rootPath: "/tmp/repo",
    label: "owner/repo",
    key: "https://gitea.example.test|owner/repo",
  };

  function run(overrides: Partial<GiteaWorkflowRun> = {}): GiteaWorkflowRun {
    return {
      id: 42,
      name: "CI",
      display_title: "Build",
      status: "completed",
      conclusion: "failure",
      workflow_id: "ci.yml",
      run_number: 12,
      event: "push",
      run_started_at: "2026-08-22T16:30:00Z",
      created_at: "2026-08-22T16:29:00Z",
      updated_at: "2026-08-22T16:31:00Z",
      html_url: "https://gitea.example.test/owner/repo/actions/runs/42",
      head_branch: "main",
      head_sha: "abc123",
      head_commit: { message: "Test commit", author: { name: "Dev" } },
      repository: {} as GiteaWorkflowRun["repository"],
      jobs_url: "https://gitea.example.test/api/jobs",
      ...overrides,
    };
  }

  function job(overrides: Partial<GiteaWorkflowJob> = {}): GiteaWorkflowJob {
    return {
      id: 7,
      run_id: 42,
      name: "Tests & Coverage",
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-22T16:30:00Z",
      completed_at: "2026-08-22T16:31:00Z",
      html_url: "https://gitea.example.test/owner/repo/actions/runs/42/jobs/7",
      runner_name: "runner-1",
      ...overrides,
    };
  }

  test("uses conclusion as the primary status once a run is completed", () => {
    assert.strictEqual(displayStatusForRun(run()), "failure");
    assert.strictEqual(
      displayStatusForRun(run({ conclusion: "success" })),
      "success",
    );
  });

  test("keeps active run status instead of a stale conclusion", () => {
    assert.strictEqual(
      displayStatusForRun(run({ status: "running", conclusion: "failure" })),
      "running",
    );
  });

  test("falls back to completed when conclusion is absent", () => {
    assert.strictEqual(displayStatusForRun(run({ conclusion: "" })), "completed");
  });

  test("keeps event and available date/time as secondary metadata", () => {
    const metadata = runSecondaryMetadata(run());
    assert.strictEqual(metadata[0], "push");
    assert.ok(metadata[1]);
    assert.doesNotMatch(metadata.join(" · "), /undefined/);
  });

  test("omits absent metadata instead of rendering undefined", () => {
    const item = new CIRunItem(
      run({
        event: "",
        run_started_at: "",
        created_at: "",
        head_branch: "",
        head_commit: undefined as unknown as GiteaWorkflowRun["head_commit"],
      }),
      repoInfo,
    );

    assert.strictEqual(item.description, "failure");
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.doesNotMatch(item.tooltip.value, /undefined/);
  });

  test("surfaces failure directly on the run row", () => {
    const item = new CIRunItem(run(), repoInfo);
    assert.match(String(item.description), /^failure · push · /);
    assert.strictEqual(item.contextValue, "ciRun_complete");
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.match(item.tooltip.value, /Status: `failure`/);
    assert.match(item.tooltip.value, /Event: `push`/);
    assert.match(item.tooltip.value, /Date:/);
  });

  test("marks running runs for cancel-only inline actions", () => {
    const item = new CIRunItem(
      run({ status: "running", conclusion: "" }),
      repoInfo,
    );
    assert.strictEqual(item.contextValue, "ciRun_active");
  });

  test("marks completed and active jobs with distinct action contexts", () => {
    assert.strictEqual(new CIJobItem(job(), 42, repoInfo).contextValue, "ciJob_complete");
    assert.strictEqual(
      new CIJobItem(
        job({ status: "running", conclusion: "" }),
        42,
        repoInfo,
      ).contextValue,
      "ciJob_active",
    );
  });
});
