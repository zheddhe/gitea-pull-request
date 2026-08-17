import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Issue detail Markdown", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issueDetailPanel.ts"),
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

  test("keeps a safe plain-text fallback instead of client-side Markdown parsing", () => {
    assert.match(source, /Issue Markdown renderer fallback/);
    assert.match(source, /return `<pre>\$\{escHtml\(markdown\)\}<\/pre>`/);
    assert.doesNotMatch(source, /function renderBody\(/);
    assert.doesNotMatch(source, /function renderComments\(/);
    assert.doesNotMatch(source, /onclick=/);
  });

  test("uses a nonce-scoped script policy and explicit external link handling", () => {
    assert.match(source, /script-src 'nonce-\$\{nonce\}'/);
    assert.match(source, /<script nonce="\$\{nonce\}">/);
    assert.match(source, /case "openExternal"/);
    assert.match(source, /resolved\.protocol !== "http:"/);
    assert.match(source, /resolved\.protocol !== "https:"/);
  });
});
