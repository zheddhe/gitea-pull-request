import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Editable WebviewView retention", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/extension.ts"),
    "utf8",
  );

  test("retains Create and Review webview contexts while hidden", () => {
    assert.match(
      source,
      /CreatePullRequestViewProvider\.viewType,[\s\S]*?createPullRequestView,[\s\S]*?retainContextWhenHidden: true/,
    );
    assert.match(
      source,
      /ReviewPullRequestViewProvider\.viewType,[\s\S]*?reviewPullRequestView,[\s\S]*?retainContextWhenHidden: true/,
    );
  });

  test("does not opt the post-merge view into retained editable context", () => {
    assert.match(
      source,
      /PostMergePullRequestViewProvider\.viewType,\s*postMergePullRequestView,\s*\)/,
    );
  });
});
