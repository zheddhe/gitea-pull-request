import * as assert from "assert";
import * as vscode from "vscode";
import type { GiteaWorkflowJob, GiteaWorkflowRun } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import {
  CIJobItem,
  CIRunItem,
  CIStepItem,
  ciRunsFingerprint,
  displayNameForRun,
  displayStatusForRun,
  resolveWorkflowName,
  runSecondaryMetadata,
  workflowLookupKeys,
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
      name: "",
      display_title: "Fix payment validation",
      status: "completed",
      conclusion: "failure",
      workflow_id: "ci.yml",
      path: ".gitea/workflows/ci.yml",
      run_number: 12,
      event: "push",
      run_started_at: "2026-08-22T16:30:00Z",
      created_at: "2026-08-22T16:29:00Z",
      updated_at: "2026-08-22T16:31:00Z",
      html_url: "https://gitea.example.test/owner/repo/actions/runs/42",
      head_branch: "main",
      head_sha: "abc123",
      head_commit: { message: "Fix payment validation", author: { name: "Dev" } },
      repository: { default_branch: "main" } as GiteaWorkflowRun["repository"],
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

  test("uses resolved workflow identity as the primary run label", () => {
    const source = run();
    assert.strictEqual(displayNameForRun(source, "CI"), "CI (main)");
    const item = new CIRunItem(source, repoInfo, "CI");
    assert.strictEqual(item.label, "CI (main)");
    assert.strictEqual(item.description?.toString().startsWith("#12 · failure · push"), true);
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.match(item.tooltip.value, /Run: `#12`/);
    assert.match(item.tooltip.value, /Workflow: `.gitea\/workflows\/ci.yml`/);
    assert.match(item.tooltip.value, /Commit title: Fix payment validation/);
  });

  test("resolves workflow metadata by id path or basename", () => {
    const names = new Map<string, string>([
      [".gitea/workflows/ci.yml", "CI"],
      ["ci.yml", "CI"],
    ]);
    assert.strictEqual(resolveWorkflowName(run(), names), "CI");
    assert.strictEqual(
      resolveWorkflowName(run({ workflow_id: "", path: ".gitea/workflows/ci.yml" }), names),
      "CI",
    );
    assert.deepStrictEqual(workflowLookupKeys("./.gitea/workflows/ci.yml"), [
      "./.gitea/workflows/ci.yml",
      ".gitea/workflows/ci.yml",
      "ci.yml",
    ]);
  });

  test("falls back through run name path workflow id and run number", () => {
    assert.strictEqual(
      displayNameForRun(run({ name: "CI payment dummy" })),
      "CI payment dummy (main)",
    );
    assert.strictEqual(
      displayNameForRun(run({ name: "", workflow_id: "", path: ".gitea/workflows/ci.yml" })),
      "ci (main)",
    );
    assert.strictEqual(
      displayNameForRun(run({ name: "", workflow_id: "build.yml", path: "" })),
      "build (main)",
    );
    assert.strictEqual(
      displayNameForRun(run({ name: "", workflow_id: "", path: "" })),
      "Run #12 (main)",
    );
  });

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
      "CI",
    );

    assert.strictEqual(item.description, "#12 · failure");
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.doesNotMatch(item.tooltip.value, /undefined/);
  });

  test("surfaces failure as a semantic front dot and muted text status", () => {
    const item = new CIRunItem(run(), repoInfo, "CI");
    assert.match(String(item.description), /^#12 · failure · push · /);
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
      "CI",
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
      "CI",
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
