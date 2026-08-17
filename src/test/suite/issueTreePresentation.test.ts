import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Issue tree presentation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../src/views/issuesProvider.ts"),
    "utf8",
  );

  test("does not expose the raw issue body as a tree child", () => {
    assert.doesNotMatch(source, /bodyPreview/);
    assert.doesNotMatch(source, /new IssueChildItem\(bodyPreview/);
  });

  test("uses a native Markdown tooltip on View Details", () => {
    assert.match(source, /new vscode\.MarkdownString\(issue\.body\)/);
    assert.match(source, /bodyTooltip\.isTrusted = false/);
    assert.match(source, /bodyTooltip\.supportHtml = false/);
    assert.match(source, /detailItem\.tooltip = bodyTooltip/);
  });
});
