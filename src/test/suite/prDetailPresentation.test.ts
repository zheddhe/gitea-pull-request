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

  test("shows review state first with branch and file stats in the common context row", () => {
    assert.match(source, /const totalAdditions = files\.reduce/);
    assert.match(source, /const totalDeletions = files\.reduce/);
    const contextStart = source.indexOf('<div class="context-row">');
    const review = source.indexOf('class="review-state', contextStart);
    const head = source.indexOf('pr.head.ref', review);
    const additions = source.indexOf('Additions <strong', head);
    const files = source.indexOf('Files <strong>${files.length}', additions);
    assert.ok(contextStart >= 0 && review > contextStart);
    assert.ok(head > review && additions > head && files > additions);
    assert.doesNotMatch(source, /class="stats-row"/);
  });

  test("uses a Discussion tab with comment count and iconography", () => {
    assert.match(source, /const discussionIcon = `<svg/);
    assert.match(source, /id="discussion-tab"/);
    assert.match(source, /Discussion \(\$\{comments\.length\}\)/);
    assert.match(source, /id="tab-discussion"/);
    assert.doesNotMatch(source, /id="details-tab"/);
  });

  test("splits title, body and target-branch updates into independent workflows", () => {
    assert.match(source, /case "editTitle"/);
    assert.match(source, /case "editBody"/);
    assert.match(source, /case "updateBase"/);
    assert.match(source, /id="title-editor"/);
    assert.match(source, /id="body-editor"/);
    assert.match(source, /id="base-editor"/);
    assert.match(source, /id="edit-body"/);
    assert.match(source, /id="edit-base"/);
    assert.doesNotMatch(source, /case "editPR"/);
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
