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
      (item) =>
        item.command === command &&
        item.when === when &&
        item.group?.startsWith("inline@"),
    );
  }

  test("uses harmonized generic action icons", () => {
    assert.strictEqual(commandIcon("gitea.viewPRDetail"), "$(eye)");
    assert.strictEqual(commandIcon("gitea.openPR"), "$(link-external)");
    assert.strictEqual(commandIcon("gitea.activatePR"), "$(arrow-right)");
    assert.strictEqual(commandIcon("gitea.viewIssueDetail"), "$(eye)");
    assert.strictEqual(commandIcon("gitea.openIssue"), "$(link-external)");
    assert.strictEqual(commandIcon("gitea.addIssueComment"), "$(comment-add)");
    assert.strictEqual(commandIcon("gitea.openRunInBrowser"), "$(link-external)");
    assert.strictEqual(commandIcon("gitea.viewLogs"), "$(output)");
  });

  test("exposes only the intended PR workflow entry actions inline", () => {
    const when = "viewItem == pullRequest";
    assert.strictEqual(inlineAction("gitea.viewPRDetail", when)?.group, "inline@1");
    assert.strictEqual(inlineAction("gitea.openPR", when)?.group, "inline@2");
    assert.strictEqual(inlineAction("gitea.activatePR", when)?.group, "inline@3");
    assert.strictEqual(
      rowActions.some(
        (item) =>
          item.when === when &&
          ["gitea.checkoutPR", "gitea.approvePR", "gitea.mergePR"].includes(
            item.command,
          ),
      ),
      false,
    );
  });

  test("exposes all useful Issue operations inline", () => {
    const both = "viewItem == issue_open || viewItem == issue_closed";
    assert.strictEqual(inlineAction("gitea.viewIssueDetail", both)?.group, "inline@1");
    assert.strictEqual(inlineAction("gitea.openIssue", both)?.group, "inline@2");
    assert.strictEqual(inlineAction("gitea.addIssueComment", both)?.group, "inline@3");
    assert.strictEqual(inlineAction("gitea.closeIssue", "viewItem == issue_open")?.group, "inline@4");
    assert.strictEqual(inlineAction("gitea.reopenIssue", "viewItem == issue_closed")?.group, "inline@4");
  });

  test("scopes CI run actions to the compatible state", () => {
    assert.strictEqual(
      inlineAction(
        "gitea.openRunInBrowser",
        "viewItem == ciRun_active || viewItem == ciRun_complete",
      )?.group,
      "inline@1",
    );
    assert.strictEqual(
      inlineAction("gitea.rerunWorkflow", "viewItem == ciRun_complete")?.group,
      "inline@2",
    );
    assert.strictEqual(
      inlineAction("gitea.cancelRun", "viewItem == ciRun_active")?.group,
      "inline@2",
    );
  });

  test("scopes CI job actions without pretending job cancellation exists", () => {
    assert.strictEqual(
      inlineAction(
        "gitea.viewLogs",
        "viewItem == ciJob_active || viewItem == ciJob_complete",
      )?.group,
      "inline@1",
    );
    assert.strictEqual(
      inlineAction("gitea.rerunJob", "viewItem == ciJob_complete")?.group,
      "inline@2",
    );
    assert.strictEqual(
      rowActions.some(
        (item) =>
          item.command === "gitea.cancelRun" &&
          (item.when?.includes("ciJob") ?? false),
      ),
      false,
    );
  });

  test("does not expose secondary right-click business action groups", () => {
    const businessItems = rowActions.filter((item) =>
      /pullRequest|issue_|ciRun|ciJob/.test(item.when ?? ""),
    );
    assert.ok(businessItems.length > 0);
    assert.ok(
      businessItems.every((item) => item.group?.startsWith("inline@")),
      "business row actions should be inline-only",
    );
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
