import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Activity Bar icon semantics", () => {
  const prSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/pullRequestProvider.ts"),
    "utf8",
  );
  const issueSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issuesProvider.ts"),
    "utf8",
  );

  test("uses the same pull request icon for All Open and Waiting for my review", () => {
    assert.match(
      prSource,
      /const icon = category === "created" \? "person" : "git-pull-request"/,
    );
    assert.match(prSource, /this\.iconPath = new vscode\.ThemeIcon\(icon\)/);
    assert.doesNotMatch(prSource, /category === "waiting" \? "charts\.yellow"/);
    assert.doesNotMatch(prSource, /request-changes/);
    assert.doesNotMatch(prSource, /comment-discussion/);
  });

  test("uses red for closed issues rather than merged-state purple", () => {
    assert.match(
      issueSource,
      /"issue-closed", new vscode\.ThemeColor\("charts\.red"\)/,
    );
    assert.doesNotMatch(
      issueSource,
      /"issue-closed", new vscode\.ThemeColor\("charts\.purple"\)/,
    );
  });
});
