import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("CI contextual access service", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/ci/services/ciContextualAccessService.ts",
    ),
    "utf8",
  );

  test("reuses CIRunsProvider instead of owning workflow job loading", () => {
    assert.match(source, /private readonly provider: CIRunsProvider/);
    assert.match(source, /provider\.getChildren\(new RepoGroupItem/);
    assert.match(source, /provider\.getChildren\(new CIRunItem/);
    assert.doesNotMatch(source, /listWorkflowJobs\(/);
  });

  test("does not introduce contextual polling or caching", () => {
    assert.doesNotMatch(source, /setInterval|setTimeout|PollingScheduler|register\(/);
    assert.doesNotMatch(source, /new Map|jobCache|cache\s*=/);
  });

  test("returns domain jobs rather than CI tree items", () => {
    assert.match(source, /Promise<readonly GiteaWorkflowJob\[\]>/);
    assert.match(source, /child instanceof CIJobItem/);
    assert.match(source, /\.map\(\(child\) => child\.job\)/);
  });
});
