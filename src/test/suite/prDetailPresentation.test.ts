import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("PR detail presentation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/prDetailPanel.ts"),
    "utf8",
  );
  const pullRequestsSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/pullRequestProvider.ts"),
    "utf8",
  );
  const changesSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/prDiffProvider.ts"),
    "utf8",
  );

  test("renders PR body, comments and review bodies through VS Code Markdown", () => {
    assert.match(source, /"markdown\.api\.render"/);
    assert.match(source, /commentBodies/);
    assert.match(source, /reviewBodies/);
    assert.doesNotMatch(source, /function renderBody\(/);
    assert.doesNotMatch(source, /function renderComments\(/);
    assert.doesNotMatch(source, /function renderReviews\(/);
  });

  test("does not dim the entire PR panel while refreshing", () => {
    assert.doesNotMatch(source, /document\.body\.style\.opacity/);
    assert.doesNotMatch(source, /postMessage\(\{ command: "loading" \}\)/);
  });

  test("separates PR lifecycle state from review state in the header", () => {
    assert.match(source, /state-merged/);
    assert.match(source, /state-open/);
    assert.match(source, /state-closed/);
    assert.match(source, /review-approved/);
    assert.match(source, /review-changes-requested/);
    assert.match(source, /review-pending/);
    assert.match(source, /class="context-row"/);
    assert.match(source, /assigned to <strong>/);
  });

  test("matches Issue detail status-dot sizing and title wording", () => {
    assert.match(
      source,
      /\.state-dot\{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:currentColor\}/,
    );
    assert.match(source, /<span class="state-dot \$\{stateClass\}"/);
    assert.match(source, /<h1>Pull Request #\$\{pr\.number\} \$\{escHtml\(pr\.title\)\}<\/h1>/);
  });

  test("makes queued inline review comments explicitly submittable", () => {
    assert.match(source, /id="submit-inline"/);
    assert.match(source, /Submit inline comments/);
    assert.match(source, /submitReview\('COMMENT'\)/);
    assert.match(source, /Inline comments are queued until you submit a review/);
  });

  test("uses VS Code theme tokens and nonce-scoped scripts", () => {
    assert.match(source, /--vscode-font-size/);
    assert.match(source, /--vscode-testing-iconPassed/);
    assert.match(source, /--vscode-testing-iconFailed/);
    assert.match(source, /script-src 'nonce-\$\{nonce\}'/);
    assert.doesNotMatch(source, /script-src 'unsafe-inline'/);
  });

  test("adds native Markdown preview to PR View Details hover", () => {
    assert.match(pullRequestsSource, /new vscode\.MarkdownString\(pr\.body\)/);
    assert.match(pullRequestsSource, /detailItem\.tooltip = preview/);
    assert.match(pullRequestsSource, /preview\.isTrusted = false/);
  });

  test("puts View Details first in Pull Requests and Changes in Pull Request", () => {
    const pullDetails = pullRequestsSource.indexOf('"View Details"');
    const pullBranch = pullRequestsSource.indexOf("`${pr.head.ref} → ${pr.base.ref}`", pullDetails);
    assert.ok(pullDetails >= 0 && pullBranch > pullDetails);

    assert.match(changesSource, /class PRDiffDetailItem/);
    const changesDetails = changesSource.indexOf("details,", changesSource.indexOf("return ["));
    const changesBranch = changesSource.indexOf("new PRDiffBranchItem", changesDetails);
    assert.ok(changesDetails >= 0 && changesBranch > changesDetails);
    assert.match(changesSource, /command: "gitea\.viewPRDetail"/);
  });
});
