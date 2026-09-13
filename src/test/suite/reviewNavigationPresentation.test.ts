import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Review navigation presentation", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  ) as {
    contributes: {
      commands: Array<{
        command: string;
        title: string;
        icon?: string | { light: string; dark: string };
      }>;
      menus: {
        "editor/title": Array<{
          command: string;
          when: string;
          group: string;
        }>;
      };
    };
  };
  const signalSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/services/reviewNavigationSignalService.ts",
    ),
    "utf8",
  );

  test("exposes ordered unresolved and visually distinct pending controls in native PR diffs", () => {
    const commands = new Map(
      manifest.contributes.commands.map((item) => [item.command, item]),
    );
    assert.ok(commands.has("gitea.previousUnresolvedReviewConversation"));
    assert.ok(commands.has("gitea.nextUnresolvedReviewConversation"));
    assert.ok(commands.has("gitea.previousPendingReviewOperation"));
    assert.ok(commands.has("gitea.nextPendingReviewOperation"));

    assert.notDeepStrictEqual(
      commands.get("gitea.previousPendingReviewOperation")?.icon,
      commands.get("gitea.previousUnresolvedReviewConversation")?.icon,
    );
    assert.notDeepStrictEqual(
      commands.get("gitea.nextPendingReviewOperation")?.icon,
      commands.get("gitea.nextUnresolvedReviewConversation")?.icon,
    );
    assert.deepStrictEqual(commands.get("gitea.previousPendingReviewOperation")?.icon, {
      light: "resources/icons/review-pending-up-light.svg",
      dark: "resources/icons/review-pending-up-dark.svg",
    });
    assert.deepStrictEqual(commands.get("gitea.nextPendingReviewOperation")?.icon, {
      light: "resources/icons/review-pending-down-light.svg",
      dark: "resources/icons/review-pending-down-dark.svg",
    });

    const titleItems = manifest.contributes.menus["editor/title"];
    const navigationItems = titleItems.filter((item) =>
      /ReviewConversation|ReviewOperation/.test(item.command),
    );
    assert.deepStrictEqual(
      navigationItems.map((item) => [item.command, item.group]),
      [
        ["gitea.previousUnresolvedReviewConversation", "navigation@20.1"],
        ["gitea.nextUnresolvedReviewConversation", "navigation@20.2"],
        ["gitea.previousPendingReviewOperation", "navigation@20.3"],
        ["gitea.nextPendingReviewOperation", "navigation@20.4"],
      ],
    );
    for (const item of navigationItems.filter((item) =>
      item.command.includes("UnresolvedReviewConversation"),
    )) {
      assert.match(item.when, /gitea\.unresolvedReviewNavigationMultipleAvailable/);
    }
    for (const item of navigationItems.filter((item) =>
      item.command.includes("PendingReviewOperation"),
    )) {
      assert.match(item.when, /resourceScheme == gitea-pr/);
      assert.match(item.when, /gitea\.pendingReviewNavigationMultipleAvailable/);
    }
  });

  test("hides native previous and next actions when a cycle has only one placeable target", () => {
    assert.match(
      signalSource,
      /setNavigationAvailable\("unresolved", unresolvedTargets\.length > 1\)/,
    );
    assert.match(
      signalSource,
      /setNavigationAvailable\("pending", pendingTargets\.length > 1\)/,
    );
    assert.match(signalSource, /gitea\.unresolvedReviewNavigationMultipleAvailable/);
    assert.match(signalSource, /gitea\.pendingReviewNavigationMultipleAvailable/);
  });
});
