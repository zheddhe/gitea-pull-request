import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Review contextual CI routing", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
    ),
    "utf8",
  );

  test("preserves job identity from Gitea check URLs", () => {
    assert.match(source, /extractGiteaJobId\(status\.target_url\)/);
    assert.match(source, /data-check-job=/);
  });

  test("passes known job identity to the shared CI routing command", () => {
    assert.match(
      source,
      /executeCommand\([\s\S]*?"gitea\.inspectCheckJobs",[\s\S]*?active\.repoInfo,[\s\S]*?runId,[\s\S]*?message\.jobId/,
    );
    assert.match(
      source,
      /type:'inspectCheckJobs',[\s\S]*?runId:Number\(button\.dataset\.checkJobs\),jobId:button\.dataset\.checkJob/,
    );
  });
});
