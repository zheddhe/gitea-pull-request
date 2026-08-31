import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Issue template discovery", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/issues/services/issueTemplateService.ts",
    ),
    "utf8",
  );

  test("uses the repository default branch and Gitea issue template directory", () => {
    assert.match(source, /default_branch/);
    assert.match(source, /\.gitea\/ISSUE_TEMPLATE/);
    assert.match(source, /ref=\$\{encodeURIComponent\(branch\)\}/);
    assert.doesNotMatch(source, /currentBranch/);
  });

  test("falls back to an empty template set when the directory is absent", () => {
    assert.match(source, /Gitea API error: 404/);
    assert.match(source, /return \[\]/);
  });

  test("only treats markdown files as issue templates", () => {
    assert.match(source, /entry\.type === "file"/);
    assert.match(source, /\\\.md\$\/i/);
  });
});
