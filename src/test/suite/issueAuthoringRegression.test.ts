import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Issue authoring regression contract", () => {
  const createSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/issues/views/createIssueView.ts",
    ),
    "utf8",
  );
  const commandSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/commands/issueCommands.ts"),
    "utf8",
  );

  test("keeps issue authoring branch-independent and avoids unsupported project metadata", () => {
    assert.doesNotMatch(createSource, /currentBranch/);
    assert.doesNotMatch(createSource, /projectId|project_id|pickProject|listProjects/);
    assert.match(createSource, /defaultBranch/);
  });

  test("keeps existing Issue Detail, filtering and row-action commands registered", () => {
    for (const command of [
      "gitea.configureIssueFilter",
      "gitea.openIssue",
      "gitea.viewIssueDetail",
      "gitea.closeIssue",
      "gitea.reopenIssue",
      "gitea.addIssueComment",
    ]) {
      assert.match(
        commandSource,
        new RegExp(
          `registerCommand\\(\\s*\\"${command.replace(/\./g, "\\.")}\\"`,
        ),
      );
    }
  });

  test("does not reintroduce the legacy issue creation prompt", () => {
    assert.doesNotMatch(
      commandSource,
      /registerCommand\(\s*"gitea\.createIssue"/,
    );
    assert.doesNotMatch(commandSource, /prompt: "Issue title"/);
    assert.doesNotMatch(commandSource, /async function createIssue\(/);
  });
});
