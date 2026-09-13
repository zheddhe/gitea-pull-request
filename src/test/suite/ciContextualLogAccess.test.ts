import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("CI contextual log access", () => {
  const commandSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/commands/ciCommands.ts"),
    "utf8",
  );

  test("exposes one domain-level Job Logs entry point", () => {
    assert.match(
      commandSource,
      /export async function openJobLogs\([\s\S]*LiveLogPanel\.show\(/,
    );
    assert.match(
      commandSource,
      /export interface CIJobLogTarget[\s\S]*repoInfo: RepoInfo;[\s\S]*job: GiteaWorkflowJob;/,
    );
  });

  test("keeps the CI tree command on the shared Job Logs path", () => {
    assert.match(
      commandSource,
      /registerCommand\(\s*"gitea\.viewLogs"[\s\S]*await openJobLogs\(/,
    );
  });

  test("does not create a second direct LiveLogPanel path in the tree command", () => {
    const commandStart = commandSource.indexOf(
      'vscode.commands.registerCommand(\n      "gitea.viewLogs"',
    );
    const nextCommand = commandSource.indexOf(
      "vscode.commands.registerCommand(",
      commandStart + 1,
    );
    const block = commandSource.slice(commandStart, nextCommand);
    assert.doesNotMatch(block, /LiveLogPanel\.show\(/);
  });
});
