import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("CI job detail presentation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/liveLogPanel.ts"),
    "utf8",
  );

  test("uses the same compact detail-header vocabulary as other detail panels", () => {
    assert.match(source, /class=\"title-row\"/);
    assert.match(source, />CI Job</);
    assert.match(source, /class=\"badge \$\{stateClass\}\"/);
    assert.match(source, /id=\"refresh\" class=\"icon-btn\"/);
    assert.match(source, /id=\"open-browser\" class=\"icon-btn\"/);
  });

  test("surfaces concise run and runner metadata", () => {
    assert.match(source, /Run #\$\{this\.job\.run_id\}/);
    assert.match(source, /Job #\$\{this\.job\.id\}/);
    assert.match(source, /Runner:/);
    assert.match(source, /Started:/);
    assert.match(source, /Completed:/);
  });

  test("keeps one aggregated execution log instead of inventing step UI", () => {
    assert.match(source, />Execution log</);
    assert.match(source, /this\.api\.getJobLogs/);
    assert.doesNotMatch(source, /GiteaJobStep/);
    assert.doesNotMatch(source, /step-level/);
  });

  test("refreshes job state and logs through the job APIs", () => {
    assert.match(source, /this\.api\.getWorkflowJob/);
    assert.match(source, /this\.api\.getJobLogs/);
  });
});
