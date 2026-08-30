import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Activity Bar icon semantics", () => {
  const prSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/pullRequestProvider.ts"),
    "utf8",
  );
  const sidebarPrSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/sidebarPullRequestProvider.ts",
    ),
    "utf8",
  );
  const issueSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issuesProvider.ts"),
    "utf8",
  );

  test("uses distinct semantic icons for PR categories", () => {
    assert.match(prSource, /category === "all" \? "git-pull-request"/);
    assert.match(prSource, /category === "waiting" \? "eye"/);
    assert.match(prSource, /: "person";/);
    assert.match(prSource, /this\.iconPath = new vscode\.ThemeIcon\(icon\)/);
  });

  test("sidebar presentation does not override Waiting for my review with a folder", () => {
    assert.doesNotMatch(
      sidebarPrSource,
      /contextValue === "category-waiting"[\s\S]*?iconPath\s*=\s*new vscode\.ThemeIcon\("folder"\)/,
    );
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
