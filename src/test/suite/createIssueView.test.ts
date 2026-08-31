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

  test("refresh preserves author input while refreshing template availability", () => {
    const refreshStart = source.indexOf("async refresh(): Promise<void>");
    const refreshEnd = source.indexOf("dispose(): void", refreshStart);
    const refreshSource = source.slice(refreshStart, refreshEnd);
    assert.match(refreshSource, /discoverTemplates\(this\.draft\.repoInfo, false\)/);
    assert.match(refreshSource, /this\.draft\.templates = discovery\.templates/);
    assert.doesNotMatch(refreshSource, /title: ""/);
    assert.doesNotMatch(refreshSource, /body: ""/);
  });

  test("exposes harmonized native repository metadata pickers", () => {
    assert.match(source, /type: "pickAssignees"/);
    assert.match(source, /type: "pickLabels"/);
    assert.match(source, /type: "pickMilestone"/);
    assert.match(source, /class="metadata-picker" data-action="pickAssignees"/);
    assert.match(source, /class="metadata-picker" data-action="pickLabels"/);
    assert.match(source, /class="metadata-picker" data-action="pickMilestone"/);
    assert.match(source, /class="chevron">›<\/span>/);
    assert.match(source, /canPickMany: true, placeHolder: "Select issue assignees"/);
    assert.match(source, /canPickMany: true, placeHolder: "Select issue labels"/);
  });

  test("discovers and applies repository issue templates", () => {
    assert.match(source, /type: "pickTemplate"/);
    assert.match(source, /this\.templateService\.discover\(repoInfo\)/);
    assert.match(source, /Blank issue/);
    assert.match(source, /Select an issue template/);
    assert.match(source, /this\.draft\.title = template\.title/);
    assert.match(source, /this\.draft\.body = template\.body/);
    assert.match(source, /template\.assigneeNames/);
    assert.match(source, /template\.labelNames/);
  });

  test("submits selected metadata with the issue", () => {
    assert.match(source, /assignees: assignees\.map\(\(user\) => user\.login\)/);
    assert.match(source, /labels: labels\.map\(\(label\) => label\.id\)/);
    assert.match(source, /milestone: milestone\?\.id/);
    const create = source.indexOf("private async createIssue");
    const refresh = source.indexOf('"gitea.refreshIssues"', create);
    const clear = source.indexOf("this.session.clear()", refresh);
    assert.ok(create >= 0 && refresh > create && clear > refresh);
  });

  test("keeps repository selection explicit and resets repository-bound state", () => {
    assert.match(source, /changeRepository/);
    assert.match(source, /Select the Gitea repository for the new issue/);
    assert.doesNotMatch(source, /currentBranch/);
    assert.match(source, /this\.draft\.assignees = \[\]/);
    assert.match(source, /this\.draft\.labels = \[\]/);
    assert.match(source, /this\.draft\.milestone = undefined/);
    assert.match(source, /this\.draft\.template = undefined/);
  });

  test("uses sidebar controls instead of legacy input boxes", () => {
    assert.match(source, /placeholder="Issue title"/);
    assert.match(source, /placeholder="Issue description \(Markdown\)"/);
    assert.match(source, /<button id="create" type="button">Create<\/button>/);
    assert.doesNotMatch(source, /showInputBox/);
  });
});
