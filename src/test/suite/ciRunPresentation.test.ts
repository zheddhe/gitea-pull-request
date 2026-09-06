import * as assert from "assert";
import * as vscode from "vscode";
import type { GiteaWorkflowJob, GiteaWorkflowRun } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import {
  CIJobItem,
  CIRunItem,
  CIStepItem,
  ciRunsFingerprint,
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

  test("surfaces failure as a semantic front dot and muted text status", () => {
    const item = new CIRunItem(run(), repoInfo);
    assert.match(String(item.description), /^failure · push · /);
    assert.strictEqual(item.contextValue, "ciRun_complete");
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "circle-filled");
    assert.strictEqual(
      ((item.iconPath as vscode.ThemeIcon).color as vscode.ThemeColor).id,
      "testing.iconFailed",
    );
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.match(item.tooltip.value, /Status: `failure`/);
  });

  test("uses orange semantic dot for running and queued token for pending", () => {
    const running = new CIRunItem(
      run({ status: "running", conclusion: "" }),
      repoInfo,
    );
    assert.strictEqual(running.contextValue, "ciRun_active");
    assert.strictEqual((running.iconPath as vscode.ThemeIcon).id, "circle-filled");
    assert.strictEqual(
      ((running.iconPath as vscode.ThemeIcon).color as vscode.ThemeColor).id,
      "charts.orange",
    );

    const queued = new CIRunItem(
      run({ status: "pending", conclusion: "" }),
      repoInfo,
    );
    assert.strictEqual(
      ((queued.iconPath as vscode.ThemeIcon).color as vscode.ThemeColor).id,
      "testing.iconQueued",
    );
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

  test("exposes returned step data as semantic child rows", () => {
    const step = {
      name: "Install dependencies",
      status: "completed",
      conclusion: "success",
      number: 1,
      started_at: "2026-08-22T16:30:00Z",
      completed_at: "2026-08-22T16:30:10Z",
    };
    const item = new CIStepItem(step, job({ steps: [step] }), 42, repoInfo);
    assert.strictEqual(item.description, "success");
    assert.strictEqual(item.contextValue, "ciStep");
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "circle-filled");
  });

  test("polling fingerprint changes when run status changes", () => {
    const before = ciRunsFingerprint([run({ status: "running", conclusion: "" })]);
    const after = ciRunsFingerprint([
      run({ status: "completed", conclusion: "success", updated_at: "2026-08-22T16:32:00Z" }),
    ]);
    assert.notStrictEqual(before, after);
  });

  test("polling fingerprint ignores presentation-only fields", () => {
    const before = ciRunsFingerprint([run()]);
    const after = ciRunsFingerprint([run({ display_title: "Renamed locally" })]);
    assert.strictEqual(before, after);
  });
});
