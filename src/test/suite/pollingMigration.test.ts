import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Central polling migration", () => {
  test("live logs no longer own a setInterval polling loop", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../src/views/liveLogPanel.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /setInterval\s*\(/);
    assert.doesNotMatch(source, /clearInterval\s*\(/);
    assert.match(source, /ci-logs:\$\{this\.repoInfo\.key\}:\$\{this\.job\.id\}/);
    assert.match(source, /this\.scheduler\.register/);
    assert.match(source, /visible: this\.panel\.visible/);
  });

  test("CI mutations no longer schedule delayed provider refresh timers", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../src/commands/ciCommands.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /setTimeout\s*\(/);
    assert.match(source, /ciPolling\.accelerate\(\)/);
  });

  test("Issues polling only activates after repositories have been loaded", () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../src/features/polling/services/issuesPollingService.ts",
      ),
      "utf8",
    );
    assert.match(source, /if \(!this\.provider\.hasLoadedRepos\(\)\)/);
    assert.match(source, /key: "issues:loaded-repositories"/);
  });
});
