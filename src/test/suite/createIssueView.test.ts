import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Create Issue sidebar", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/issues/views/createIssueView.ts",
    ),
    "utf8",
  );

  test("keeps title and body synchronized in the provider draft", () => {
    assert.match(source, /interface CreateIssueDraft/);
    assert.match(source, /title: string/);
    assert.match(source, /body: string/);
    assert.match(source, /type: "updateForm"/);
    assert.match(source, /title\.addEventListener\('input', formChanged\)/);
    assert.match(source, /body\.addEventListener\('input', formChanged\)/);
    assert.match(source, /this\.draft\.title = message\.title/);
    assert.match(source, /this\.draft\.body = message\.body/);
  });

  test("refresh preserves the current authoring draft", () => {
    const refreshStart = source.indexOf("async refresh(): Promise<void>");
    const refreshEnd = source.indexOf("dispose(): void", refreshStart);
    const refreshSource = source.slice(refreshStart, refreshEnd);
    assert.match(refreshSource, /this\.draft/);
    assert.match(refreshSource, /this\.render\(\)/);
    assert.doesNotMatch(refreshSource, /title: ""/);
    assert.doesNotMatch(refreshSource, /body: ""/);
  });

  test("creates through Gitea then refreshes Issues and leaves create mode", () => {
    assert.match(source, /this\.api\.createIssue\(repoInfo, \{ title, body \}\)/);
    const create = source.indexOf("private async createIssue");
    const refresh = source.indexOf('"gitea.refreshIssues"', create);
    const clear = source.indexOf("this.session.clear()", refresh);
    assert.ok(create >= 0 && refresh > create && clear > refresh);
  });

  test("keeps repository selection explicit and authoring branch-independent", () => {
    assert.match(source, /changeRepository/);
    assert.match(source, /Select the Gitea repository for the new issue/);
    assert.doesNotMatch(source, /currentBranch/);
  });

  test("uses sidebar controls instead of legacy input boxes", () => {
    assert.match(source, /placeholder="Issue title"/);
    assert.match(source, /placeholder="Issue description \(Markdown\)"/);
    assert.match(source, />Create Issue<\/button>/);
    assert.doesNotMatch(source, /showInputBox/);
  });
});
