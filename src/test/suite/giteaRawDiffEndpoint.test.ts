import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Gitea raw PR diff endpoint", () => {
  test("uses the authenticated API endpoint instead of the web route", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../src/api/giteaApiClient.ts"),
      "utf8",
    );

    const methodStart = source.indexOf("async getPRRawDiff");
    const nextMethod = source.indexOf("async listPRCommits", methodStart);
    assert.ok(methodStart >= 0 && nextMethod > methodStart);
    const method = source.slice(methodStart, nextMethod);

    assert.match(method, /this\.requestText\(/);
    assert.match(method, /`\/repos\/\$\{owner\}\/\$\{repo\}\/pulls\/\$\{number\}\.diff`/);
    assert.doesNotMatch(method, /`\$\{serverUrl\}\/\$\{owner\}\/\$\{repo\}\/pulls\/\$\{number\}\.diff`/);
  });
});
