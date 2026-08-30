import * as assert from "assert";
import type { GiteaIssue, GiteaUser } from "../../api/types";
import { isIssueAssignedTo } from "../../views/issuesProvider";

suite("Issue assignment aggregation", () => {
  const user = (login: string): GiteaUser => ({
    id: login.length,
    login,
    full_name: login,
    email: `${login}@example.test`,
    avatar_url: "",
  });

  const issue = (overrides: Partial<GiteaIssue> = {}): GiteaIssue => ({
    id: 1,
    number: 1,
    title: "Issue",
    body: "",
    state: "open",
    html_url: "https://gitea.example.test/owner/repo/issues/1",
    user: user("author"),
    comments: 0,
    created_at: "2026-08-22T16:00:00Z",
    updated_at: "2026-08-22T16:00:00Z",
    ...overrides,
  });

  test("matches the legacy single assignee field", () => {
    assert.strictEqual(
      isIssueAssignedTo(issue({ assignee: user("me") }), "me"),
      true,
    );
  });

  test("matches the multi-assignee collection", () => {
    assert.strictEqual(
      isIssueAssignedTo(
        issue({ assignees: [user("other"), user("me")] }),
        "me",
      ),
      true,
    );
  });

  test("rejects issues assigned only to other users", () => {
    assert.strictEqual(
      isIssueAssignedTo(
        issue({ assignee: user("other"), assignees: [user("other")] }),
        "me",
      ),
      false,
    );
  });
});
