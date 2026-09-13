import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Review navigation presentation", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  ) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      menus: {
        "editor/title": Array<{
          command: string;
          when: string;
          group: string;
        }>;
      };
    };
  };

  test("exposes independent unresolved and pending controls in native PR diffs", () => {
    const commands = new Set(
      manifest.contributes.commands.map((item) => item.command),
    );
    assert.ok(commands.has("gitea.previousUnresolvedReviewConversation"));
    assert.ok(commands.has("gitea.nextUnresolvedReviewConversation"));
    assert.ok(commands.has("gitea.previousPendingReviewOperation"));
    assert.ok(commands.has("gitea.nextPendingReviewOperation"));

    const titleItems = manifest.contributes.menus["editor/title"];
    const unresolved = titleItems.filter((item) =>
      item.command.includes("UnresolvedReviewConversation"),
    );
    const pending = titleItems.filter((item) =>
      item.command.includes("PendingReviewOperation"),
    );
    assert.strictEqual(unresolved.length, 2);
    assert.strictEqual(pending.length, 2);
    for (const item of pending) {
      assert.match(item.when, /resourceScheme == gitea-pr/);
      assert.match(item.when, /gitea\.pendingReviewNavigationAvailable/);
    }
    assert.ok(
      [...unresolved, ...pending].every(
        (item) => item.group === "navigation@20",
      ),
      "unresolved and pending controls should stay in one primary editor-title group",
    );
  });
});