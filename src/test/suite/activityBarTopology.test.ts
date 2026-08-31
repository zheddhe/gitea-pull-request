import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Activity Bar topology", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  ) as {
    contributes?: {
      viewsContainers?: {
        activitybar?: Array<{ id: string; title: string; icon: string }>;
      };
      views?: Record<
        string,
        Array<{
          id: string;
          name: string;
          when?: string;
          initialSize?: number;
          visibility?: string;
        }>
      >;
      commands?: Array<{ command: string; title: string; icon?: string }>;
      menus?: {
        "view/title"?: Array<{
          command: string;
          when?: string;
          group?: string;
        }>;
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
    for (const id of [
      "gitea.pullRequests",
      "gitea.createPullRequest",
      "gitea.issues",
      "gitea.createIssue",
      "gitea.ciRuns",
    ]) {
      assert.ok(general.some((view) => view.id === id), `missing ${id}`);
    }
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

  test("isolates normal, pull-request create and issue create layouts", () => {
    const general = packageJson.contributes?.views?.giteaPullRequest ?? [];
    const byId = new Map(general.map((view) => [view.id, view]));
    const idleWhen = "!gitea.prSession.creating && !gitea.issueCreation.active";
    for (const id of ["gitea.pullRequests", "gitea.issues", "gitea.ciRuns"]) {
      assert.strictEqual(byId.get(id)?.when, idleWhen);
      assert.strictEqual(byId.get(id)?.initialSize, undefined);
    }

    assert.strictEqual(
      byId.get("gitea.createPullRequest")?.when,
      "gitea.prSession.creating && !gitea.issueCreation.active",
    );
    assert.strictEqual(byId.get("gitea.createPullRequest")?.initialSize, 8);
    assert.strictEqual(byId.get("gitea.pullRequestsCreateMode")?.initialSize, 2);
    assert.strictEqual(byId.get("gitea.issuesCreateCompact")?.visibility, "collapsed");
    assert.strictEqual(byId.get("gitea.ciRunsCreateCompact")?.visibility, "collapsed");

    assert.strictEqual(
      byId.get("gitea.createIssue")?.when,
      "gitea.issueCreation.active && !gitea.prSession.creating",
    );
    assert.strictEqual(byId.get("gitea.createIssue")?.initialSize, 8);
    assert.strictEqual(byId.get("gitea.issuesIssueCreateMode")?.initialSize, 2);
    assert.strictEqual(
      byId.get("gitea.pullRequestsIssueCreateCompact")?.visibility,
      "collapsed",
    );
    assert.strictEqual(
      byId.get("gitea.ciRunsIssueCreateCompact")?.visibility,
      "collapsed",
    );
  });

  test("uses native refresh then close for both create workspaces", () => {
    const commands = packageJson.contributes?.commands ?? [];
    const titleActions = packageJson.contributes?.menus?.["view/title"] ?? [];

    for (const commandId of ["gitea.refreshCreatePR", "gitea.refreshCreateIssue"]) {
      assert.strictEqual(
        commands.find((command) => command.command === commandId)?.icon,
        "$(refresh)",
      );
    }
    for (const commandId of ["gitea.cancelCreatePR", "gitea.cancelCreateIssue"]) {
      assert.strictEqual(
        commands.find((command) => command.command === commandId)?.icon,
        "$(close)",
      );
    }

    const prWhen =
      "view == gitea.createPullRequest && gitea.prSession.creating && !gitea.issueCreation.active";
    assert.strictEqual(
      titleActions.find(
        (item) => item.command === "gitea.refreshCreatePR" && item.when === prWhen,
      )?.group,
      "navigation@1",
    );
    assert.strictEqual(
      titleActions.find(
        (item) => item.command === "gitea.cancelCreatePR" && item.when === prWhen,
      )?.group,
      "navigation@2",
    );

    const issueWhen =
      "view == gitea.createIssue && gitea.issueCreation.active && !gitea.prSession.creating";
    assert.strictEqual(
      titleActions.find(
        (item) =>
          item.command === "gitea.refreshCreateIssue" && item.when === issueWhen,
      )?.group,
      "navigation@1",
    );
    assert.strictEqual(
      titleActions.find(
        (item) =>
          item.command === "gitea.cancelCreateIssue" && item.when === issueWhen,
      )?.group,
      "navigation@2",
    );
  });

  test("keeps established PR title actions", () => {
    const actions = packageJson.contributes?.menus?.["view/title"] ?? [];
    for (const view of ["gitea.prDiff", "gitea.reviewPullRequest"]) {
      const when = `view == ${view} && gitea.prSession.active`;
      const byCommand = (command: string) =>
        actions.find((item) => item.command === command && item.when === when);
      assert.strictEqual(byCommand("gitea.viewActivePRDetail")?.group, "navigation@0");
      assert.strictEqual(byCommand("gitea.openActivePR")?.group, "navigation@1");
      assert.strictEqual(byCommand("gitea.refreshActivePR")?.group, "navigation@2");
      assert.strictEqual(byCommand("gitea.clearActivePR")?.group, "navigation@3");
    }
  });

  test("keeps post-merge refresh and close semantics", () => {
    const commands = packageJson.contributes?.commands ?? [];
    assert.strictEqual(
      commands.find((command) => command.command === "gitea.refreshPostMerge")?.icon,
      "$(refresh)",
    );
    assert.strictEqual(
      commands.find((command) => command.command === "gitea.finishPostMerge")?.icon,
      "$(close)",
    );
  });

  test("Create Pull Request keeps form synchronization and native metadata pickers", () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/pullRequests/views/createPullRequestView.ts",
      ),
      "utf8",
    );
    assert.match(source, /type: "updateForm"/);
    assert.match(source, /title\.addEventListener\('input', formChanged\)/);
    assert.match(source, /body\.addEventListener\('input', formChanged\)/);
    assert.match(source, /async refreshBranches\(\): Promise<void>/);
    assert.match(source, /canPickMany: true/);
    assert.doesNotMatch(source, /Use legacy create flow/);
  });

  test("Issue creation uses the dedicated sidebar provider and no legacy create prompt", () => {
    const extensionSource = fs.readFileSync(
      path.resolve(__dirname, "../../../src/extension.ts"),
      "utf8",
    );
    const issueCommandSource = fs.readFileSync(
      path.resolve(__dirname, "../../../src/commands/issueCommands.ts"),
      "utf8",
    );
    const createIssueSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/issues/views/createIssueView.ts",
      ),
      "utf8",
    );

    assert.match(extensionSource, /new IssueCreationSessionService\(\)/);
    assert.match(extensionSource, /new CreateIssueViewProvider/);
    assert.match(extensionSource, /"gitea\.createIssue"/);
    assert.match(createIssueSource, /static readonly viewType = "gitea\.createIssue"/);
    assert.match(createIssueSource, /async start\(\): Promise<void>/);
    assert.match(createIssueSource, /async refresh\(\): Promise<void>/);
    assert.doesNotMatch(issueCommandSource, /registerCommand\("gitea\.createIssue"/);
    assert.doesNotMatch(issueCommandSource, /prompt: "Issue title"/);
    assert.doesNotMatch(createIssueSource, /createIssue\(/);
  });

  test("Create Issue command has a native title icon", () => {
    const commands = packageJson.contributes?.commands ?? [];
    assert.strictEqual(
      commands.find((command) => command.command === "gitea.createIssue")?.icon,
      "$(add)",
    );
  });

  test("Issues keep keyboard-native Open/Closed filtering", () => {
    const providerSource = fs.readFileSync(
      path.resolve(__dirname, "../../../src/views/issuesProvider.ts"),
      "utf8",
    );
    const commandSource = fs.readFileSync(
      path.resolve(__dirname, "../../../src/commands/issueCommands.ts"),
      "utf8",
    );
    assert.match(providerSource, /class IssueScopeItem extends vscode\.TreeItem/);
    assert.match(providerSource, /command: "gitea\.configureIssueFilter"/);
    assert.match(providerSource, /new vscode\.ThemeIcon\("filter"\)/);
    assert.match(providerSource, /getFilter\(\): IssueFilter/);
    assert.match(commandSource, /"gitea\.configureIssueFilter"/);
    assert.match(commandSource, /showQuickPick<IssueFilterQuickPickItem>/);
    assert.match(commandSource, /issuesProvider\.setFilter\(choice\.filter\)/);
  });

  test("PR Webviews keep primary interactions keyboard-native", () => {
    const createSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/pullRequests/views/createPullRequestView.ts",
      ),
      "utf8",
    );
    const reviewSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
      ),
      "utf8",
    );
    const postMergeSource = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/pullRequests/views/postMergePullRequestView.ts",
      ),
      "utf8",
    );
    for (const source of [createSource, reviewSource, postMergeSource]) {
      assert.match(source, /<button/);
      assert.doesNotMatch(source, /tabindex="-1"/);
      assert.doesNotMatch(source, /onmousedown=/);
    }
    assert.match(createSource, /<label for="base">/);
    assert.match(createSource, /<label for="head">/);
    assert.match(reviewSource, /<textarea id="reviewBody"/);
    assert.match(reviewSource, /<select id="mergeMethod"/);
  });
});
