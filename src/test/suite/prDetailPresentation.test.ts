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
    assert.match(source, /<span>Pull Request #\$\{pr\.number\}<\/span>/);
    assert.match(source, /id="title-text" class="title-text"/);
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

  test("edits the title in place and saves on blur or Enter", () => {
    assert.match(source, /id="title-row" class="title-row"/);
    assert.match(source, /id="title-text" class="title-text"/);
    assert.match(source, /id="title-input" class="title-input"/);
    assert.match(source, /class="icon-btn" title="Edit title"/);
    assert.match(source, /function beginTitleEdit\(\)/);
    assert.match(source, /function finishTitleEdit\(save\)/);
    assert.match(source, /addEventListener\('blur'/);
    assert.match(source, /event\.key==='Enter'/);
    assert.match(source, /event\.key==='Escape'/);
    assert.match(source, /case "editTitle"/);
    assert.doesNotMatch(source, /id="save-title"/);
    assert.doesNotMatch(source, /id="cancel-title"/);
  });

  test("places global refresh beside the title instead of the action row", () => {
    assert.match(source, /id="refresh" class="icon-btn" title="Refresh pull request"/);
    const titleRow = source.indexOf('id="title-row"');
    const refresh = source.indexOf('id="refresh"', titleRow);
    const actions = source.indexOf('<div class="actions">', refresh);
    assert.ok(titleRow >= 0 && refresh > titleRow && actions > refresh);
    const actionEnd = source.indexOf("</div>", actions);
    assert.ok(!source.slice(actions, actionEnd).includes('id="refresh"'));
  });

  test("uses the target branch itself as the base branch selector", () => {
    assert.match(source, /id="base-select"/);
    assert.match(source, /class="branch-select"/);
    assert.match(source, /aria-label="Target branch"/);
    assert.match(source, /post\('updateBase',\{base\}\)/);
    assert.doesNotMatch(source, /id="base-editor"/);
    assert.doesNotMatch(source, /id="edit-base"/);
  });

  test("uses aligned Description and Comments section bars", () => {
    assert.match(source, /class="section-bar"><span>Description<\/span>/);
    assert.match(source, /id="edit-body" class="icon-btn"/);
    assert.match(source, /class="section-bar"><span>Comments \(\$\{comments\.length\}\)<\/span>/);
    assert.match(source, /id="body-editor" class="description-editor"/);
    assert.match(source, /case "editBody"/);
    assert.match(source, /placeholder="Write a comment\.\.\."/);
    assert.match(source, /aria-label="Add a comment"/);
    assert.doesNotMatch(source, /<label for="comment-body">Add a comment<\/label>/);
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
    const pullBranch = pullRequestsSource.indexOf(
      "`${pr.head.ref} → ${pr.base.ref}`",
      pullDetails,
    );
    assert.ok(pullDetails >= 0 && pullBranch > pullDetails);

    assert.match(changesSource, /class PRDiffDetailItem/);
    const changesDetails = changesSource.indexOf(
      "details,",
      changesSource.indexOf("return ["),
    );
    const changesBranch = changesSource.indexOf(
      "new PRDiffBranchItem",
      changesDetails,
    );
    assert.ok(changesDetails >= 0 && changesBranch > changesDetails);
    assert.match(changesSource, /command: "gitea\.viewPRDetail"/);
  });
});
