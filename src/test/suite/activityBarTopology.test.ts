import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Activity Bar topology", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  ) as {
    contributes?: {
      viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon: string }> };
      views?: Record<string, Array<{ id: string; name: string; when?: string }>>;
      commands?: Array<{ command: string; title: string; icon?: string }>;
      menus?: {
        "view/title"?: Array<{ command: string; when?: string; group?: string }>;
      };
    };
  };

  test("separates general Gitea and contextual pull request containers", () => {
    const containers = packageJson.contributes?.viewsContainers?.activitybar ?? [];

    assert.ok(containers.some((container) => container.id === "giteaPullRequest"));
    assert.ok(
      containers.some((container) => container.id === "giteaPullRequestContext"),
    );

    const general = packageJson.contributes?.views?.giteaPullRequest ?? [];
    const contextual = packageJson.contributes?.views?.giteaPullRequestContext ?? [];

    assert.deepStrictEqual(
      general.map((view) => view.id),
      [
        "gitea.pullRequests",
        "gitea.createPullRequest",
        "gitea.issues",
        "gitea.ciRuns",
      ],
    );

    assert.deepStrictEqual(
      contextual.map((view) => view.id),
      [
        "gitea.prDiff",
        "gitea.reviewPullRequest",
        "gitea.postMergePullRequest",
      ],
    );
  });

  test("keeps contextual PR views state-driven", () => {
    const contextual = packageJson.contributes?.views?.giteaPullRequestContext ?? [];
    const byId = new Map(contextual.map((view) => [view.id, view]));

    assert.ok(byId.get("gitea.prDiff")?.when?.includes("gitea.prSession.active"));
    assert.strictEqual(
      byId.get("gitea.reviewPullRequest")?.when,
      "gitea.prSession.active",
    );
    assert.strictEqual(
      byId.get("gitea.postMergePullRequest")?.when,
      "gitea.prSession.merged",
    );
  });

  test("uses distinct Activity Bar icon assets", () => {
    const containers = packageJson.contributes?.viewsContainers?.activitybar ?? [];
    const general = containers.find((container) => container.id === "giteaPullRequest");
    const contextual = containers.find(
      (container) => container.id === "giteaPullRequestContext",
    );

    assert.ok(general?.icon);
    assert.ok(contextual?.icon);
    assert.notStrictEqual(general?.icon, contextual?.icon);
  });

  test("sidebar presentation expands repository, all-open and waiting queues", () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/pullRequests/views/sidebarPullRequestProvider.ts",
      ),
      "utf8",
    );

    assert.match(source, /contextValue === "repoGroup"/);
    assert.match(source, /contextValue === "category-all"/);
    assert.match(source, /contextValue === "category-waiting"/);
    assert.match(source, /TreeItemCollapsibleState\.Expanded/);
  });

  test("uses refresh then close consistently on active PR view titles", () => {
    const commands = packageJson.contributes?.commands ?? [];
    const refresh = commands.find(
      (command) => command.command === "gitea.refreshActivePR",
    );
    assert.strictEqual(refresh?.icon, "$(refresh)");

    const titleActions = packageJson.contributes?.menus?.["view/title"] ?? [];
    for (const view of ["gitea.prDiff", "gitea.reviewPullRequest"]) {
      const expectedWhen = `view == ${view} && gitea.prSession.active`;
      const refreshAction = titleActions.find(
        (item) =>
          item.command === "gitea.refreshActivePR" && item.when === expectedWhen,
      );
      const closeAction = titleActions.find(
        (item) =>
          item.command === "gitea.clearActivePR" && item.when === expectedWhen,
      );

      assert.ok(refreshAction, `missing refresh title action for ${view}`);
      assert.ok(closeAction, `missing close title action for ${view}`);
      assert.strictEqual(refreshAction.group, "navigation@1");
      assert.strictEqual(closeAction.group, "navigation@2");
    }
  });
});
