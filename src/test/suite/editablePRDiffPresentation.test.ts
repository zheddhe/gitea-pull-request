import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Editable PR diff presentation", () => {
  const commandsSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/commands/workingFileCommands.ts",
    ),
    "utf8",
  );
  const bridgeSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/services/workingFileBridgeService.ts",
    ),
    "utf8",
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  );

  test("keeps editable diff explicit and separate from snapshot review", () => {
    assert.match(commandsSource, /"gitea\.openEditablePRDiff"/);
    assert.match(commandsSource, /LOCAL EDIT · PR #/);
    assert.match(commandsSource, /"vscode\.diff"/);
    assert.match(commandsSource, /baseUri,\s*resolved\.uri/);
    assert.ok(
      packageJson.contributes.commands.some(
        (command: { command: string }) => command.command === "gitea.openEditablePRDiff",
      ),
    );
  });

  test("requires a safe working file and exact PR head baseline", () => {
    assert.match(commandsSource, /workingFileBridge\.resolve/);
    assert.match(commandsSource, /localText !== headText/);
    assert.match(commandsSource, /localDiffersFromHead/);
    assert.match(commandsSource, /authoritative PR state/);
    assert.match(bridgeSource, /async resolve\(/);
    assert.match(bridgeSource, /evaluateWorkingFileBridge/);
  });

  test("exposes editable diff as its own compact file action", () => {
    const menu = packageJson.contributes.menus["view/item/context"] as Array<{
      command: string;
      group?: string;
    }>;
    const editable = menu.find((entry) => entry.command === "gitea.openEditablePRDiff");
    const working = menu.find((entry) => entry.command === "gitea.openWorkingFile");
    const checkout = menu.find(
      (entry) => entry.command === "gitea.checkoutSourceAndOpenWorkingFile",
    );
    assert.strictEqual(editable?.group, "inline@2");
    assert.strictEqual(working?.group, "inline@1");
    assert.strictEqual(checkout?.group, "inline@3");
  });
});
