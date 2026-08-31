import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Merge readiness presentation", () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
    ),
    "utf8",
  );

  test("does not synthesize readiness from partial state while loading", () => {
    assert.match(
      source,
      /const readiness = this\.readiness\.loading\s*\? undefined\s*:\s*this\.currentReadiness\(active\.state\)/,
    );
    assert.match(
      source,
      /this\.busy \|\| this\.readiness\.loading \|\| !readiness\?\.canMerge \|\| !selected/,
    );
  });

  test("renders only a neutral refresh message while readiness is loading", () => {
    assert.match(
      source,
      /const readinessHtml = this\.readiness\.loading\s*\? '<div class="muted">Refreshing merge readiness…<\/div>'/,
    );
    assert.match(
      source,
      /<div class="section-title">\$\{readinessIcon\}<span>Merge readiness<\/span><\/div>\s*\$\{readinessHtml\}/,
    );
  });

  test("keeps resolved positive and blocking conclusions behind the resolved branch", () => {
    const readinessHtml = source.indexOf("const readinessHtml = this.readiness.loading");
    const positive = source.indexOf(
      "No blocking condition detected from available Gitea signals.",
      readinessHtml,
    );
    const blockers = source.indexOf('class="blocked"', readinessHtml);
    const webview = source.indexOf("this.view.webview.html", readinessHtml);

    assert.ok(readinessHtml >= 0);
    assert.ok(blockers > readinessHtml && blockers < webview);
    assert.ok(positive > readinessHtml && positive < webview);
  });
});
