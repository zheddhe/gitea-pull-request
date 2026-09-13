import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Review contextual CI access", () => {
  const reviewSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
    ),
    "utf8",
  );
  const commandSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/commands/ciCommands.ts"),
    "utf8",
  );

  test("exposes jobs and logs only for checks backed by a Gitea Actions run", () => {
    assert.match(reviewSource, /runId:\s*extractGiteaRunId\(status\.target_url\)/);
    assert.match(reviewSource, /runId\s*\?\s*`<button[^`]*data-check-jobs=/);
    assert.match(reviewSource, /type:\s*"inspectCheckJobs";\s*runId:\s*number/);
    assert.match(
      reviewSource,
      /executeCommand\(\s*"gitea\.inspectCheckJobs",\s*active\.repoInfo,\s*runId/,
    );
  });

  test("keeps CI loading and Job Logs outside the Review implementation", () => {
    assert.doesNotMatch(reviewSource, /listWorkflowJobs/);
    assert.doesNotMatch(reviewSource, /LiveLogPanel/);
    assert.doesNotMatch(reviewSource, /setInterval|setTimeout/);
    assert.match(commandSource, /new CIContextualAccessService\(api, ciProvider\)/);
    assert.match(
      commandSource,
      /registerCommand\(\s*"gitea\.inspectCheckJobs"/,
    );
    assert.match(
      commandSource,
      /contextualAccess\.loadJobsForRun\(repoInfo, runId\)/,
    );
  });

  test("opens a single job directly and uses a state-aware picker for multiple jobs", () => {
    assert.match(commandSource, /if \(jobs\.length === 1\)/);
    assert.match(commandSource, /showQuickPick\(items/);
    assert.match(commandSource, /description:\s*presentation\.statusLabel/);
    assert.match(
      commandSource,
      /executeCommand\(\s*"gitea\.viewLogs",\s*\{ repoInfo, job \}\s*\)/,
    );
  });

  test("lets both tree jobs and contextual domain targets use the same Job Logs command", () => {
    assert.match(
      commandSource,
      /async \(arg: CIJobItem \| CIJobLogTarget\)/,
    );
    assert.match(commandSource, /const target = jobLogTarget\(arg\)/);
    assert.match(commandSource, /await openJobLogs\(/);
  });
});
