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
  const reviewSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../src/features/pullRequests/views/reviewPullRequestView.ts",
    ),
    "utf8",
  );

  test("renders PR body, comments and review bodies through VS Code Markdown", () => {
    assert.match(source, /"markdown\.api\.render"/);
    assert.match(source, /commentBodies/);
    assert.match(source, /reviewBodies/);
  });

  test("does not dim the entire PR panel while refreshing", () => {
    assert.doesNotMatch(source, /document\.body\.style\.opacity/);
    assert.doesNotMatch(source, /postMessage\(\{ command: "loading" \}\)/);
  });

  test("keeps PR state, review state and branch context distinct", () => {
    assert.match(source, /state-merged/);
    assert.match(source, /state-open/);
    assert.match(source, /state-closed/);
    assert.match(source, /review-approved/);
    assert.match(source, /review-changes-requested/);
    assert.match(source, /review-pending/);
    assert.match(source, /class="review-row"/);
    assert.match(source, /class="branch-row"/);
    assert.match(source, /<span class="context-label">Review<\/span>/);
    assert.match(source, /<span class="context-label">Source branch<\/span>/);
    assert.match(source, /<span class="context-label">Base branch<\/span>/);
    assert.match(source, /assigned to <strong>/);
  });

  test("keeps the title prefix fixed while editing only the title value", () => {
    assert.match(source, /class="title-prefix">Pull Request #\$\{pr\.number\}/);
    assert.match(source, /id="title-text" class="title-text"/);
    assert.match(source, /id="title-input" class="title-input"/);
    assert.match(source, /function setTitleEditing\(editing\)/);
    assert.match(source, /function saveTitle\(\)/);
    assert.match(source, /addEventListener\('blur',saveTitle\)/);
    assert.match(source, /event\.key==='Enter'/);
    assert.match(source, /event\.key==='Escape'/);
    assert.doesNotMatch(source, /id="save-title"/);
    assert.doesNotMatch(source, /id="cancel-title"/);
  });

  test("places global refresh beside the title", () => {
    assert.match(
      source,
      /id="refresh" class="icon-btn" title="Refresh pull request"/,
    );
    const title = source.indexOf('class="title-prefix"');
    const refresh = source.indexOf('id="refresh"', title);
    const actions = source.indexOf('<div class="actions">', refresh);
    assert.ok(title >= 0 && refresh > title && actions > refresh);
  });

  test("uses the base branch itself as an inline selector", () => {
    assert.match(source, /id="base-select"/);
    assert.match(source, /class="branch-select"/);
    assert.match(source, /aria-label="Base branch"/);
    assert.match(source, /post\('updateBase',\{base\}\)/);
    assert.doesNotMatch(source, /id="base-editor"/);
    assert.doesNotMatch(source, /id="edit-base"/);
  });

  test("keeps diff statistics out of PR detail", () => {
    assert.doesNotMatch(source, /totalAdditions/);
    assert.doesNotMatch(source, /totalDeletions/);
    assert.doesNotMatch(source, /Additions <strong/);
    assert.doesNotMatch(source, /Deletions <strong/);
    assert.doesNotMatch(source, /Files <strong>/);
  });

  test("opens Reviews by default and aligns review action order", () => {
    assert.match(source, /class="tab active" id="reviews-tab"/);
    assert.match(source, /id="tab-reviews" class="tab-content active"/);
    assert.match(source, /<div class="review-submit"><strong>Review<\/strong>/);
    const reviewActions = source.indexOf('class="review-actions"');
    const comment = source.indexOf('data-review-event="COMMENT"', reviewActions);
    const approve = source.indexOf('data-review-event="APPROVED"', comment);
    const request = source.indexOf('data-review-event="REQUEST_CHANGES"', approve);
    assert.ok(reviewActions >= 0 && comment > reviewActions);
    assert.ok(approve > comment && request > approve);
    assert.doesNotMatch(source, /Submit Review/);
  });

  test("shows only a compact pending inline comment counter", () => {
    assert.match(source, /id="pending-inline-label"/);
    assert.match(source, /Pending inline comments: 0/);
    assert.match(source, /Pending inline comments: '\+count/);
    assert.doesNotMatch(source, /Inline comments are queued until you submit a review/);
    assert.doesNotMatch(source, /file\(s\) changed · Select a diff line/);
  });

  test("uses aligned Description and Comments section bars", () => {
    assert.match(source, /class="section-bar"><span>Description<\/span>/);
    assert.match(source, /id="edit-body" class="icon-btn"/);
    assert.match(source, /class="section-bar"><span>Comments \(\$\{comments\.length\}\)<\/span>/);
    assert.match(source, /id="body-editor" class="description-editor"/);
    assert.match(source, /placeholder="Write a comment\.\.\."/);
  });

  test("keeps View Details first and prioritizes commits and reviews before files", () => {
    const pullDetails = pullRequestsSource.indexOf('"View Details"');
    const pullBranch = pullRequestsSource.indexOf(
      "`${pr.head.ref} → ${pr.base.ref}`",
      pullDetails,
    );
    assert.ok(pullDetails >= 0 && pullBranch > pullDetails);

    const changesDetails = changesSource.indexOf("details,", changesSource.indexOf("return ["));
    const commits = changesSource.indexOf("commitsSection", changesDetails);
    const reviews = changesSource.indexOf("reviewsSection", commits);
    const files = changesSource.indexOf("filesSection", reviews);
    assert.ok(changesDetails >= 0 && commits > changesDetails);
    assert.ok(reviews > commits && files > reviews);
  });

  test("aligns sidebar Review context and action styling", () => {
    assert.match(
      reviewSource,
      /Review Pull Request #\$\{pr\.number\} \(\$\{active\.repoInfo\.label\}\)/,
    );
    assert.match(reviewSource, /<strong>Source branch<\/strong>/);
    assert.match(reviewSource, /<strong>Base branch<\/strong>/);
    assert.doesNotMatch(reviewSource, /class="title">#\$\{pr\.number\}/);
    assert.match(reviewSource, /class="success-outline" id="approve"/);
    assert.match(reviewSource, /class="danger-outline" id="requestChanges"/);
    assert.match(reviewSource, /class="outline" id="checkoutBase"/);
  });

  test("keeps native Markdown preview on PR View Details hover", () => {
    assert.match(pullRequestsSource, /new vscode\.MarkdownString\(pr\.body\)/);
    assert.match(pullRequestsSource, /detailItem\.tooltip = preview/);
    assert.match(pullRequestsSource, /preview\.isTrusted = false/);
  });
});