import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Activity Bar topology", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
  ) as {
    contributes?: {
      viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon: string }> };
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

    assert.ok(general.some((view) => view.id === "gitea.pullRequests"));
    assert.ok(general.some((view) => view.id === "gitea.createPullRequest"));
    assert.ok(general.some((view) => view.id === "gitea.issues"));
    assert.ok(general.some((view) => view.id === "gitea.ciRuns"));

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

  test("isolates standard and focused create-mode Gitea layouts", () => {
    const general = packageJson.contributes?.views?.giteaPullRequest ?? [];
    const byId = new Map(general.map((view) => [view.id, view]));

    for (const id of ["gitea.pullRequests", "gitea.issues", "gitea.ciRuns"]) {
      assert.strictEqual(byId.get(id)?.when, "!gitea.prSession.creating");
      assert.strictEqual(byId.get(id)?.initialSize, undefined);
    }

    assert.strictEqual(
      byId.get("gitea.createPullRequest")?.when,
      "gitea.prSession.creating",
    );
    assert.strictEqual(
      byId.get("gitea.issuesCreateCompact")?.visibility,
      "collapsed",
    );
    assert.strictEqual(
      byId.get("gitea.ciRunsCreateCompact")?.visibility,
      "collapsed",
    );
    assert.strictEqual(
      byId.get("gitea.issuesCreateCompact")?.when,
      "gitea.prSession.creating",
    );
    assert.strictEqual(
      byId.get("gitea.ciRunsCreateCompact")?.when,
      "gitea.prSession.creating",
    );
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

  test("uses native refresh then close for Create Pull Request", () => {
    const commands = packageJson.contributes?.commands ?? [];
    const refresh = commands.find(
      (command) => command.command === "gitea.refreshCreatePR",
    );
    const close = commands.find(
      (command) => command.command === "gitea.cancelCreatePR",
    );
    assert.strictEqual(refresh?.icon, "$(refresh)");
    assert.strictEqual(close?.icon, "$(close)");

    const titleActions = packageJson.contributes?.menus?.["view/title"] ?? [];
    const expectedWhen =
      "view == gitea.createPullRequest && gitea.prSession.creating";
    const refreshAction = titleActions.find(
      (item) =>
        item.command === "gitea.refreshCreatePR" && item.when === expectedWhen,
    );
    const closeAction = titleActions.find(
      (item) =>
        item.command === "gitea.cancelCreatePR" && item.when === expectedWhen,
    );

    assert.ok(refreshAction);
    assert.ok(closeAction);
    assert.strictEqual(refreshAction.group, "navigation@1");
    assert.strictEqual(closeAction.group, "navigation@2");
  });

  test("uses native refresh then close for post-merge", () => {
    const commands = packageJson.contributes?.commands ?? [];
    const refresh = commands.find(
      (command) => command.command === "gitea.refreshPostMerge",
    );
    const close = commands.find(
      (command) => command.command === "gitea.finishPostMerge",
    );
    assert.strictEqual(refresh?.icon, "$(refresh)");
    assert.strictEqual(close?.icon, "$(close)");

    const titleActions = packageJson.contributes?.menus?.["view/title"] ?? [];
    const expectedWhen =
      "view == gitea.postMergePullRequest && gitea.prSession.merged";
    const refreshAction = titleActions.find(
      (item) =>
        item.command === "gitea.refreshPostMerge" && item.when === expectedWhen,
    );
    const closeAction = titleActions.find(
      (item) =>
        item.command === "gitea.finishPostMerge" && item.when === expectedWhen,
    );

    assert.ok(refreshAction);
    assert.ok(closeAction);
    assert.strictEqual(refreshAction.group, "navigation@1");
    assert.strictEqual(closeAction.group, "navigation@2");
  });

  test("uses native close semantics for create and post-merge views", () => {
    const commands = packageJson.contributes?.commands ?? [];
    for (const commandId of ["gitea.cancelCreatePR", "gitea.finishPostMerge"]) {
      const command = commands.find((item) => item.command === commandId);
      assert.strictEqual(command?.icon, "$(close)");
    }

    const titleActions = packageJson.contributes?.menus?.["view/title"] ?? [];
    assert.ok(
      titleActions.some(
        (item) =>
          item.command === "gitea.cancelCreatePR" &&
          item.when === "view == gitea.createPullRequest && gitea.prSession.creating",
      ),
    );
    assert.ok(
      titleActions.some(
        (item) =>
          item.command === "gitea.finishPostMerge" &&
          item.when === "view == gitea.postMergePullRequest && gitea.prSession.merged",
      ),
    );
  });

  test("Create view keeps form fields synchronized before native refresh", () => {
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
    assert.match(source, /await this\.api\.listBranches\(repoInfo\)/);
  });

  test("removes Webview controls superseded by native title actions", () => {
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

    assert.doesNotMatch(createSource, /id="cancel"/);
    assert.doesNotMatch(reviewSource, /id="refresh"/);
    assert.doesNotMatch(postMergeSource, /id="done"/);
    assert.doesNotMatch(postMergeSource, /id="refresh"/);
    assert.match(postMergeSource, /async refreshBranchState\(\): Promise<void>/);
  });

  test("Review keeps checks PR-centric without duplicating the CI browser", () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
      ),
      "utf8",
    );

    assert.match(source, /<div class="section-title">Checks<\/div>/);
    assert.match(source, /status\.target_url/);
    assert.match(source, /successfulChecks/);
    assert.match(source, /pendingChecks/);
    assert.match(source, /failedChecks/);
    assert.doesNotMatch(source, /listWorkflowRuns/);
  });

  test("Issues expose a keyboard-native Open/Closed filter", () => {
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
    assert.match(createSource, /<label for="title">/);
    assert.match(createSource, /<label for="body">/);
    assert.match(reviewSource, /<textarea id="reviewBody"/);
    assert.match(reviewSource, /<select id="mergeMethod"/);
    assert.match(reviewSource, /data-check-url=/);
  });
});
