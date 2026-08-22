import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Activity Bar row actions", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  ) as {
    contributes?: {
      commands?: Array<{ command: string; icon?: string }>;
      menus?: {
        "view/item/context"?: Array<{
          command: string;
          when?: string;
          group?: string;
        }>;
      };
    };
  };

  const commands = packageJson.contributes?.commands ?? [];
  const rowActions = packageJson.contributes?.menus?.["view/item/context"] ?? [];

  function commandIcon(command: string): string | undefined {
    return commands.find((item) => item.command === command)?.icon;
  }

  function inlineAction(command: string, when: string) {
    return rowActions.find(
      (item) => item.command === command && item.when === when && item.group?.startsWith("inline@"),
    );
  }

  test("uses harmonized generic action icons", () => {
    assert.strictEqual(commandIcon("gitea.viewPRDetail"), "$(eye)");
    assert.strictEqual(commandIcon("gitea.openPR"), "$(link-external)");
    assert.strictEqual(commandIcon("gitea.activatePR"), "$(arrow-right)");
    assert.strictEqual(commandIcon("gitea.viewIssueDetail"), "$(eye)");
    assert.strictEqual(commandIcon("gitea.openIssue"), "$(link-external)");
  });

  test("exposes generic PR actions inline on the PR row", () => {
    const when = "viewItem == pullRequest";
    assert.strictEqual(inlineAction("gitea.viewPRDetail", when)?.group, "inline@1");
    assert.strictEqual(inlineAction("gitea.openPR", when)?.group, "inline@2");
    assert.strictEqual(inlineAction("gitea.activatePR", when)?.group, "inline@3");
  });

  test("exposes generic Issue actions inline on the Issue row", () => {
    const when = "viewItem == issue_open || viewItem == issue_closed";
    assert.strictEqual(inlineAction("gitea.viewIssueDetail", when)?.group, "inline@1");
    assert.strictEqual(inlineAction("gitea.openIssue", when)?.group, "inline@2");
  });

  test("keeps pull requests as leaf business objects with rich tooltip metadata", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../src/views/pullRequestProvider.ts"),
      "utf8",
    );
    assert.match(
      source,
      /`#\$\{pr\.number\} \$\{pr\.title\}`,[\s\S]*vscode\.TreeItemCollapsibleState\.None/,
    );
    assert.doesNotMatch(source, /class PRChildItem/);
    assert.doesNotMatch(source, /buildPRChildren/);
    assert.match(source, /`\\`\$\{pr\.head\.ref\}\\` → \\`\$\{pr\.base\.ref\}\\``/);
    assert.match(source, /review comment\(s\)/);
    assert.match(source, /Changes:/);
  });
});
