import * as assert from "assert";
import { parseIssueTemplate } from "../../features/issues/domain/issueTemplate";

suite("Issue template parsing", () => {
  test("parses supported front matter and keeps markdown body", () => {
    const template = parseIssueTemplate(
      ".gitea/ISSUE_TEMPLATE/bug.md",
      [
        "---",
        'name: "Bug report"',
        "about: Report a reproducible problem",
        'title: "[BUG] "',
        "labels: [bug, triage]",
        "assignees: alice, bob",
        "projects: ignored-project",
        "---",
        "## What happened?",
        "",
        "Describe the problem.",
      ].join("\n"),
    );

    assert.strictEqual(template.name, "Bug report");
    assert.strictEqual(template.about, "Report a reproducible problem");
    assert.strictEqual(template.title, "[BUG] ");
    assert.deepStrictEqual(template.labelNames, ["bug", "triage"]);
    assert.deepStrictEqual(template.assigneeNames, ["alice", "bob"]);
    assert.strictEqual(template.body, "## What happened?\n\nDescribe the problem.");
  });

  test("falls back to the filename and preserves a plain markdown template", () => {
    const template = parseIssueTemplate(
      ".gitea/ISSUE_TEMPLATE/feature-request.md",
      "## Proposal\n\nDescribe the desired behavior.",
    );

    assert.strictEqual(template.name, "feature-request");
    assert.strictEqual(template.title, "");
    assert.deepStrictEqual(template.labelNames, []);
    assert.deepStrictEqual(template.assigneeNames, []);
    assert.strictEqual(template.body, "## Proposal\n\nDescribe the desired behavior.");
  });

  test("treats unterminated front matter as normal markdown", () => {
    const source = "---\nname: Incomplete\n## Body";
    const template = parseIssueTemplate(".gitea/ISSUE_TEMPLATE/incomplete.md", source);
    assert.strictEqual(template.name, "incomplete");
    assert.strictEqual(template.body, source);
  });
});
