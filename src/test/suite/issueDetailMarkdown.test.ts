import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Issue detail Markdown", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issueDetailPanel.ts"),
    "utf8",
  );
  const issuesSource = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issuesProvider.ts"),
    "utf8",
  );

  test("uses the VS Code Markdown renderer for issue content", () => {
    assert.match(source, /"markdown\.api\.render"/);
    assert.match(source, /this\.renderMarkdown\(issue\.body \?\? ""\)/);
    assert.match(
      source,
      /comments\.map\(\(comment\) => this\.renderMarkdown\(comment\.body \?\? ""\)\)/,
    );
  });

  test("keeps a safe plain-text fallback and explicit external link handling", () => {
    assert.match(source, /Issue Markdown renderer fallback/);
    assert.match(source, /return `<pre>\$\{escHtml\(markdown\)\}<\/pre>`/);
    assert.match(source, /script-src 'nonce-\$\{nonce\}'/);
    assert.match(source, /<script nonce="\$\{nonce\}">/);
    assert.match(source, /case "openExternal"/);
    assert.match(source, /resolved\.protocol !== "http:"/);
    assert.match(source, /resolved\.protocol !== "https:"/);
    assert.doesNotMatch(source, /onclick=/);
  });

  test("aligns issue title editing with PR detail", () => {
    assert.match(source, /class="title-prefix">Issue #\$\{issue\.number\}/);
    assert.match(source, /id="title-text" class="title-text"/);
    assert.match(source, /id="title-input" class="title-input"/);
    assert.match(source, /id="edit-title" class="icon-btn"/);
    assert.match(source, /addEventListener\('blur',saveTitle\)/);
    assert.match(source, /event\.key==='Enter'/);
    assert.match(source, /event\.key==='Escape'/);
    assert.match(source, /case "editTitle"/);
  });

  test("keeps only browser and refresh context actions beside issue title", () => {
    const title = source.indexOf('class="title-prefix"');
    const edit = source.indexOf('id="edit-title"', title);
    const browser = source.indexOf('id="open-browser"', edit);
    const refresh = source.indexOf('id="refresh"', browser);
    assert.ok(title >= 0 && edit > title && browser > edit && refresh > browser);
    assert.doesNotMatch(source, /case "close"/);
    assert.doesNotMatch(source, /case "reopen"/);
    assert.doesNotMatch(source, /id="close-/);
    assert.doesNotMatch(source, /id="reopen-/);
  });

  test("uses a Description card with local edit action and simple comments composer", () => {
    assert.match(source, /class="section-bar"><span>Description<\/span>/);
    assert.match(source, /id="edit-body" class="icon-btn"/);
    assert.match(source, /id="body-editor" class="description-editor"/);
    assert.match(source, /case "editBody"/);
    assert.match(source, /Comments \(\$\{comments\.length\}\)/);
    assert.match(source, /placeholder="Write a comment\.\.\."/);
    assert.doesNotMatch(source, />Add a comment</);
  });

  test("edits issue comments locally with the shared Gitea comment API", () => {
    assert.match(source, /case "editComment"/);
    assert.match(source, /this\.api\.updateComment\(this\.repoInfo, commentId, body\.trim\(\)\)/);
    assert.match(source, /class="icon-btn edit-comment"/);
    assert.match(source, /class="comment-editor"/);
    assert.match(source, /class="btn save-comment"/);
    assert.match(source, /class="btn sec cancel-comment"/);
    assert.match(source, /function setCommentEditing\(id,editing\)/);
  });

  test("removes obsolete issue tabs and history", () => {
    assert.doesNotMatch(source, /class="tabs"/);
    assert.doesNotMatch(source, /class="tab"/);
    assert.doesNotMatch(source, />History</);
    assert.doesNotMatch(source, /createdDate/);
    assert.doesNotMatch(source, /updatedDate/);
    assert.doesNotMatch(source, /closedDate/);
  });

  test("keeps issue metadata available on the flat Activity Bar row", () => {
    assert.doesNotMatch(issuesSource, /function buildIssueChildren/);
    assert.doesNotMatch(issuesSource, /class IssueChildItem/);
    assert.match(issuesSource, /new vscode\.MarkdownString\(tooltipLines\.join\("\\n\\n"\)\)/);
    assert.match(issuesSource, /issue\.body\.trim\(\)/);
    assert.match(issuesSource, /Labels: \$\{issue\.labels\.map/);
    assert.match(issuesSource, /Assignees: \$\{issue\.assignees\.map/);
    assert.match(issuesSource, /Milestone: \$\{issue\.milestone\.title\}/);
    assert.match(issuesSource, /\$\{issue\.comments\} comment\(s\)/);
    assert.match(issuesSource, /tooltip\.isTrusted = false/);
    assert.match(issuesSource, /tooltip\.supportHtml = false/);
  });

  test("styles issue detail from VS Code theme tokens", () => {
    assert.match(source, /--success:var\(--vscode-testing-iconPassed/);
    assert.match(source, /--danger:var\(--vscode-testing-iconFailed/);
    assert.match(source, /--input-bg:var\(--vscode-input-background/);
    assert.match(source, /--button-bg:var\(--vscode-button-background/);
    assert.match(source, /\.markdown-body h2\{font-size:1\.16em\}/);
    assert.match(source, /\.markdown-body table\{/);
    assert.doesNotMatch(source, /#2da44e/);
    assert.doesNotMatch(source, /#cf222e/);
  });
});