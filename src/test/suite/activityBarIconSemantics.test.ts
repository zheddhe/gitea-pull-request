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

  test("uses semantic icons for pull request categories", () => {
    assert.match(prSource, /category === "all" \? "git-pull-request"/);
    assert.match(prSource, /category === "waiting" \? "request-changes"/);
    assert.match(prSource, /: "person"/);
    assert.doesNotMatch(prSource, /category === "all" \? "folder"/);
    assert.doesNotMatch(prSource, /category === "waiting" \? "folder"/);
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
