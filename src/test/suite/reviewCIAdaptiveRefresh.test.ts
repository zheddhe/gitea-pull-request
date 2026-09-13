import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Review CI adaptive refresh ownership", () => {
  const contextualSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/ci/services/ciContextualAccessService.ts",
    ),
    "utf8",
  );
  const providerSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/ciRunsProvider.ts"),
    "utf8",
  );
  const pollingSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/polling/services/ciRunsPollingService.ts",
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

  test("contextual access enrolls the repository in the existing CI provider state", () => {
    assert.match(contextualSource, /provider\.getChildren\(new RepoGroupItem/);
    assert.match(providerSource, /this\.stateMap\.set\(repoInfo\.key, state\)/);
    assert.match(providerSource, /this\.pollingStateEmitter\.fire\(\)/);
  });

  test("the existing CI polling service owns subsequent refresh and cache invalidation", () => {
    assert.match(
      pollingSource,
      /this\.provider\.onDidChangePollingState\(\(\) => this\.syncRegistration\(\)\)/,
    );
    assert.match(pollingSource, /key:\s*"ci-runs:loaded-repositories"/);
    assert.match(pollingSource, /this\.provider\.pollLoadedRuns\(\)/);
    assert.match(providerSource, /if \(changed\) \{[\s\S]*this\.jobCache\.clear\(\)/);
  });

  test("Review never owns a second CI timer, scheduler registration or job cache", () => {
    assert.doesNotMatch(reviewSource, /PollingScheduler|CIRunsPollingService/);
    assert.doesNotMatch(reviewSource, /setInterval|setTimeout/);
    assert.doesNotMatch(reviewSource, /jobCache|new Map/);
    assert.doesNotMatch(contextualSource, /PollingScheduler|register\(|setInterval|setTimeout/);
  });
});
