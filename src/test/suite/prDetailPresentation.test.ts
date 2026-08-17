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

  test("places review status in the PR title and keeps branches out of detail", () => {
    const dot = source.indexOf('class="state-dot');
    const review = source.indexOf('class="review-state', dot);
    const title = source.indexOf('class="title-prefix"', review);
    assert.ok(dot >= 0 && review > dot && title > review);
    assert.match(source, /review-approved/);
    assert.match(source, /review-changes-requested/);
    assert.match(source, /review-pending/);
    assert.doesNotMatch(source, /class="branch-row"/);
    assert.doesNotMatch(source, /id="base-select"/);
    assert.doesNotMatch(source, /post\('updateBase'/);
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
  });

  test("keeps only edit browser and refresh context actions beside the title", () => {
    const title = source.indexOf('class="title-prefix"');
    const edit = source.indexOf('id="edit-title"', title);
    const browser = source.indexOf('id="open-browser"', edit);
    const refresh = source.indexOf('id="refresh"', browser);
    const tabs = source.indexOf('<nav class="tabs"', refresh);
    assert.ok(title >= 0 && edit > title && browser > edit && refresh > browser);
    assert.ok(tabs > refresh);
    assert.doesNotMatch(source, /id="checkout"/);
    assert.doesNotMatch(source, /id="merge-method"/);
    assert.doesNotMatch(source, /id="merge"/);
    assert.doesNotMatch(source, /id="change-state"/);
  });

  test("keeps diff statistics out of PR detail", () => {
    assert.doesNotMatch(source, /totalAdditions/);
    assert.doesNotMatch(source, /totalDeletions/);
    assert.doesNotMatch(source, /Additions <strong/);
    assert.doesNotMatch(source, /Deletions <strong/);
    assert.doesNotMatch(source, /Files <strong>/);
  });

  test("opens Reviews by default with only inline comment submission actions", () => {
    assert.match(source, /class="tab active" id="reviews-tab"/);
    assert.match(source, /id="tab-reviews" class="tab-content active"/);
    assert.match(source, /id="submit-inline"/);
    assert.match(source, /submitInlineReview/);
    assert.match(source, /Pending inline comments: 0/);
    assert.doesNotMatch(source, /data-review-event=/);
    assert.doesNotMatch(source, /id="review-body"/);
    assert.doesNotMatch(source, />Approve<\/button>/);
    assert.doesNotMatch(source, />Request Changes<\/button>/);
  });

  test("restores file status color cues in the Reviews tab", () => {
    assert.match(source, /class="file-status \$\{statusClass\}"/);
    assert.match(source, /file-status-added/);
    assert.match(source, /file-status-deleted/);
    assert.match(source, /file-status-modified/);
    assert.match(source, /diff-add \.lc/);
    assert.match(source, /diff-del \.lc/);
  });

  test("uses aligned Description and Comments section bars", () => {
    assert.match(source, /class="section-bar"><span>Description<\/span>/);
    assert.match(source, /id="edit-body" class="icon-btn"/);
    assert.match(
      source,
      /class="section-bar"><span>Comments \(\$\{comments\.length\}\)<\/span>/,
    );
    assert.match(source, /id="body-editor" class="description-editor"/);
    assert.match(source, /placeholder="Write a comment\.\.\."/);
  });

  test("removes View Details from Changes tree while keeping data section order", () => {
    assert.doesNotMatch(changesSource, /class PRDiffDetailItem/);
    assert.doesNotMatch(changesSource, /new PRDiffDetailItem/);
    const branch = changesSource.indexOf("new PRDiffBranchItem");
    const commits = changesSource.indexOf("commitsSection", branch);
    const reviews = changesSource.indexOf("reviewsSection", commits);
    const files = changesSource.indexOf("filesSection", reviews);
    assert.ok(branch >= 0 && commits > branch && reviews > commits && files > reviews);
  });

  test("makes sidebar Review the branch management hub", () => {
    assert.match(
      reviewSource,
      /Review Pull Request #\$\{pr\.number\} \(\$\{active\.repoInfo\.label\}\)/,
    );
    const branches = reviewSource.indexOf('<span>Branch management</span>');
    const readiness = reviewSource.indexOf('<span>Merge readiness</span>', branches);
    const checks = reviewSource.indexOf('<span>Checks</span>', readiness);
    const review = reviewSource.indexOf('<span>Review</span>', checks);
    const actions = reviewSource.indexOf('<span>Actions</span>', review);
    assert.ok(branches >= 0 && readiness > branches && checks > readiness);
    assert.ok(review > checks && actions > review);
    assert.match(reviewSource, /id="baseBranch"/);
    assert.match(reviewSource, /type: "updateBase"/);
    assert.match(reviewSource, /message\.type === "updateBase"/);
    assert.match(reviewSource, /id="checkoutSource"/);
    assert.match(reviewSource, /id="checkoutBase"/);
    assert.match(reviewSource, /class="section-icon"/);
    assert.match(reviewSource, />Merge PR<\/button>/);
    assert.match(reviewSource, /id="closePR"/);
  });

  test("keeps native Markdown preview on PR View Details hover", () => {
    assert.match(pullRequestsSource, /new vscode\.MarkdownString\(pr\.body\)/);
    assert.match(pullRequestsSource, /detailItem\.tooltip = preview/);
    assert.match(pullRequestsSource, /preview\.isTrusted = false/);
  });
});
