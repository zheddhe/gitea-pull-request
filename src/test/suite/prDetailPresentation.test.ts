import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("PR detail presentation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/prDetailPanel.ts"),
    "utf8",
  );
  const sidebarSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/sidebarPullRequestProvider.ts",
    ),
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
    assert.match(source, /const stateIcon = "●"/);
    assert.match(source, /assigned to <strong>/);
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
    assert.match(sidebarSource, /new vscode\.MarkdownString\(element\.pr\.body\)/);
    assert.match(sidebarSource, /detailItem\.tooltip = preview/);
    assert.match(sidebarSource, /preview\.isTrusted = false/);
  });
});
