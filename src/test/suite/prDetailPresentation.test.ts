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

  test("renders PR and inline review content through VS Code Markdown", () => {
    assert.match(source, /"markdown\.api\.render"/);
    assert.match(source, /commentBodies/);
    assert.match(source, /reviewBodies/);
    assert.match(source, /reviewCommentBodies/);
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

  test("opens Inline Reviews first and separates Review History", () => {
    const inlineTab = source.indexOf('class="tab active" id="inline-reviews-tab"');
    const historyTab = source.indexOf('id="review-history-tab"', inlineTab);
    const discussionTab = source.indexOf('id="discussion-tab"', historyTab);
    assert.ok(inlineTab >= 0 && historyTab > inlineTab && discussionTab > historyTab);
    assert.match(source, /id="tab-inline-reviews" class="tab-content active"/);
    assert.match(source, /id="tab-review-history" class="tab-content"/);
    assert.match(source, /Inline Reviews \(\$\{reviewConversations\.length\}\)/);
    assert.match(source, /Review History \(\$\{activeReviews\.length\}\)/);
    assert.match(source, /const reviewConversations = buildReviewConversations\(reviewComments\)/);
    assert.match(source, /id="submit-inline"/);
    assert.match(source, /submitInlineReview/);
    assert.match(source, /Pending inline comments: 0/);
    assert.doesNotMatch(source, /data-review-event=/);
    assert.doesNotMatch(source, /id="review-body"/);
  });

  test("preserves active PR detail tab across refresh renders", () => {
    assert.match(source, /const savedState=vscode\.getState\(\)\|\|\{\}/);
    assert.match(source, /vscode\.setState\(Object\.assign\(\{\},vscode\.getState\(\)\|\|\{\},\{activeTab:name\}\)\)/);
    assert.match(source, /const restoredTab=typeof savedState\.activeTab==='string'\?savedState\.activeTab:'inline-reviews'/);
    assert.match(source, /showTab\(restoredTab,restoredButton,false\)/);
  });

  test("enriches review history with inline COMMENT detail and sorting", () => {
    assert.match(source, /comment\.pull_request_review_id === review\.id/);
    assert.match(source, /review-inline-summary/);
    assert.match(source, /review-inline-message/);
    assert.match(source, /reviewCommentBodies\[commentIndex\]/);
    assert.match(source, /data-review-time=/);
    assert.match(source, /id="review-history-sort"/);
    assert.match(source, />Oldest first<\/option>/);
    assert.match(source, />Newest first<\/option>/);
    assert.match(source, /function sortReviewHistory\(direction\)/);
  });

  test("restores file status color cues and readable file names", () => {
    assert.match(source, /class="file-status \$\{statusClass\}"/);
    assert.match(source, /file-status-added/);
    assert.match(source, /file-status-deleted/);
    assert.match(source, /file-status-modified/);
    assert.match(source, /\.file-header\{[^}]*color:var\(--fg\)/);
    assert.match(source, /\.file-path\{[^}]*color:var\(--fg\)/);
    assert.match(source, /diff-add \.lc/);
    assert.match(source, /diff-del \.lc/);
  });

  test("places existing inline conversations by either side of the diff", () => {
    assert.match(source, /const byNewLine = new Map<number, ReviewConversation\[\]>/);
    assert.match(source, /const byOldLine = new Map<number, ReviewConversation\[\]>/);
    assert.match(source, /byNewLine\.get\(line\.newLine\)/);
    assert.match(source, /byOldLine\.get\(line\.oldLine\)/);
    assert.match(source, /conversationCommentIds\(conversation\)/);
    assert.match(source, /matchedCommentIds/);
    assert.match(source, /Unplaced inline conversations/);
    assert.match(source, /review-conversation/);
    assert.match(source, /review-comment-body markdown-body/);
  });

  test("renders and submits replies against the conversation root when supported", () => {
    assert.match(source, /const REPLY_ICON = `<svg/);
    assert.match(source, /capabilities\.inlineReviewReplies/);
    assert.match(source, /class="icon-btn reply-toggle" data-comment-id="\$\{root\.id\}"/);
    assert.match(source, /title="Reply to conversation"/);
    assert.match(source, /id="reply-form-\$\{root\.id\}"/);
    assert.match(source, /case "replyInlineComment"/);
    assert.match(source, /"gitea\.replyInlineReviewComment"/);
    assert.match(source, /post\('replyInlineComment',\{commentId:Number\(id\),body\}\)/);
  });

  test("hides unsupported reply actions and explains the server capability once", () => {
    assert.match(source, /"gitea\.getReviewCapabilities"/);
    assert.match(source, /capabilities\.inlineReviewReplies/);
    assert.match(source, /Replies require Gitea 1\.27\+/);
    assert.match(source, /class="capability-note"/);
    assert.match(source, /\.capability-note\{[^}]*margin-left:auto/);
  });

  test("renders compact resolved state separately from review comment authorship", () => {
    assert.match(source, /const RESOLVED_EVENT_ICON = `<svg/);
    assert.match(source, /class="conversation-event resolved-event"/);
    assert.match(source, /resolved this conversation/);
    assert.match(source, /root\.resolver\?\.login/);
    assert.match(source, /\.conversation-event\{[^}]*display:flex/);
    assert.doesNotMatch(source, /conversation-state resolved/);
  });

  test("exposes resolve and reopen as compact capability-gated actions", () => {
    assert.match(source, /capabilities\.inlineReviewResolution/);
    assert.match(source, /class="icon-btn resolve-conversation"/);
    assert.match(source, /title="Resolve conversation"/);
    assert.match(source, /class="icon-btn reopen-conversation"/);
    assert.match(source, /title="Reopen conversation"/);
    assert.match(source, /case "resolveInlineConversation"/);
    assert.match(source, /case "reopenInlineConversation"/);
    assert.match(source, /"gitea\.resolveInlineReviewConversation"/);
    assert.match(source, /"gitea\.reopenInlineReviewConversation"/);
    assert.match(source, /post\('resolveInlineConversation'/);
    assert.match(source, /post\('reopenInlineConversation'/);
  });

  test("visually distinguishes roots replies and compact conversation actions", () => {
    assert.match(source, /class="review-comment-card conversation-root"/);
    assert.match(source, /\.review-conversation\{[^}]*border:1px solid var\(--border\)/);
    assert.match(source, /\.review-reply\{[^}]*margin-left:22px/);
    assert.match(source, /\.review-reply::before/);
    assert.match(source, /\.conversation-actions\{[^}]*gap:2px/);
    assert.match(source, /\.reply-form\{[^}]*margin-left:22px/);
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

  test("edits PR discussion comments locally without changing inline reviews", () => {
    assert.match(source, /case "editComment"/);
    assert.match(source, /this\.api\.updateComment\(this\.repoInfo, commentId, body\.trim\(\)\)/);
    assert.match(source, /class="icon-btn edit-comment"/);
    assert.match(source, /class="comment-editor"/);
    assert.match(source, /class="btn save-comment"/);
    assert.match(source, /class="btn sec cancel-comment"/);
    assert.match(source, /function setCommentEditing\(id,editing\)/);
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

  test("orders sidebar Review around the user workflow", () => {
    assert.match(
      reviewSource,
      /Review Pull Request #\$\{pr\.number\} \(\$\{active\.repoInfo\.label\}\)/,
    );
    const branches = reviewSource.indexOf('<span>Branch identification</span>');
    const review = reviewSource.indexOf('<span>Review</span>', branches);
    const checks = reviewSource.indexOf('<span>Checks</span>', review);
    const readiness = reviewSource.indexOf('<span>Merge readiness</span>', checks);
    const actions = reviewSource.indexOf('<span>Actions</span>', readiness);
    assert.ok(branches >= 0 && review > branches && checks > review);
    assert.ok(readiness > checks && actions > readiness);
    assert.match(
      reviewSource,
      /<select aria-label="Source branch" disabled><option selected>/,
    );
    assert.doesNotMatch(reviewSource, /branch-arrow/);
    assert.doesNotMatch(reviewSource, />↓</);
    assert.match(reviewSource, /id="baseBranch"/);
    assert.match(reviewSource, /type: "updateBase"/);
    assert.match(reviewSource, /message\.type === "updateBase"/);
    assert.match(reviewSource, /id="checkoutSource"/);
    assert.match(reviewSource, /id="checkoutBase"/);
    assert.match(reviewSource, /class="section-icon"/);
    assert.match(reviewSource, />Merge PR<\/button>/);
    assert.match(reviewSource, /id="closePR"/);
  });

  test("keeps native Markdown preview on the flat PR row", () => {
    assert.doesNotMatch(pullRequestsSource, /class PRChildItem/);
    assert.doesNotMatch(pullRequestsSource, /function buildPRChildren/);
    assert.match(
      pullRequestsSource,
      /new vscode\.MarkdownString\(tooltipLines\.join\("\\n\\n"\)\)/,
    );
    assert.match(pullRequestsSource, /pr\.body\.trim\(\)/);
    assert.match(pullRequestsSource, /tooltip\.isTrusted = false/);
    assert.match(pullRequestsSource, /tooltip\.supportHtml = false/);
    assert.match(pullRequestsSource, /Assignees: \$\{pr\.assignees\.map/);
    assert.match(pullRequestsSource, /Labels: \$\{pr\.labels\.map/);
    assert.match(pullRequestsSource, /Changes: \+\$\{pr\.additions\}/);
  });
});
