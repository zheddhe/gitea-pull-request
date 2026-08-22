import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Issue tree presentation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issuesProvider.ts"),
    "utf8",
  );

  test("keeps issues as leaf business objects", () => {
    assert.match(
      source,
      /super\(`#\$\{issue\.number\} \$\{issue\.title\}`, vscode\.TreeItemCollapsibleState\.None\)/,
    );
    assert.doesNotMatch(source, /class IssueChildItem/);
    assert.doesNotMatch(source, /buildIssueChildren/);
  });

  test("moves useful secondary metadata and body preview to the issue tooltip", () => {
    assert.match(source, /const tooltipLines = \[/);
    assert.match(source, /Assignees:/);
    assert.match(source, /Labels:/);
    assert.match(source, /Milestone:/);
    assert.match(source, /issue\.body\.trim\(\)/);
    assert.match(source, /tooltip\.isTrusted = false/);
    assert.match(source, /tooltip\.supportHtml = false/);
  });
});
