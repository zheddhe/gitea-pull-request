import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Review visibility refresh", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
    ),
    "utf8",
  );

  test("refreshes only from the webview visibility event", () => {
    assert.match(source, /view\.onDidChangeVisibility\(\(\) => \{/);
    assert.match(source, /if \(view\.visible\) void this\.refreshOnVisibility\(\);/);
    assert.doesNotMatch(source, /setInterval\s*\(/);
    assert.doesNotMatch(source, /setTimeout\s*\(/);
  });

  test("tracks review drafts while allowing bounded visibility refresh", () => {
    assert.match(source, /\{ type: "draftChanged"; body: string \}/);
    assert.match(source, /body\?\.addEventListener\('input',[\s\S]*?type:'draftChanged'/);
    assert.match(source, /hasDraft: this\.reviewBody\.length > 0/);
    assert.match(source, /if \(message\.type !== "draftChanged"\)/);
  });

  test("preserves a draft when refreshing the same active pull request", () => {
    assert.match(source, /const nextIdentity = this\.pullRequestIdentity\(state\)/);
    assert.match(
      source,
      /if \(nextIdentity !== this\.activePullRequestIdentity\) \{\s*this\.reviewBody = "";/,
    );
    assert.match(
      source,
      /return state\.kind === "active"\s*\? `\$\{state\.repository\.key\}#\$\{state\.pullRequest\.number\}`/,
    );
  });

  test("preserves scroll position across bounded rerenders", () => {
    assert.match(source, /const persistedState=vscode\.getState\(\) \|\| \{\}/);
    assert.match(source, /window\.scrollTo\(0,persistedState\.scrollY\)/);
    assert.match(source, /vscode\.setState\(\{\.\.\.vscode\.getState\(\),scrollY:window\.scrollY\}\)/);
  });

  test("reuses normal session activation so PR and readiness consumers refresh together", () => {
    assert.match(source, /await this\.api\.getPullRequest\(/);
    assert.match(source, /await this\.session\.activate\(/);
    assert.match(source, /this\.prProvider\.refresh\(\)/);
  });
});
