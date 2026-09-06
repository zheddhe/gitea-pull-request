import * as assert from "assert";
import type { GiteaIssue } from "../../api/types";
import { issueListFingerprint } from "../../views/issuesProvider";

function issue(overrides: Partial<GiteaIssue> = {}): GiteaIssue {
  return {
    id: 1,
    number: 1,
    title: "Issue",
    body: "",
    state: "open",
    html_url: "https://gitea.example.test/owner/repo/issues/1",
    user: { login: "dev" } as GiteaIssue["user"],
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    comments: 0,
    ...overrides,
  };
}

suite("Issues polling", () => {
  test("fingerprint is stable for identical issue data", () => {
    assert.strictEqual(issueListFingerprint([issue()]), issueListFingerprint([issue()]));
  });

  test("fingerprint changes when issue metadata changes", () => {
    const before = issueListFingerprint([issue()]);
    const after = issueListFingerprint([
      issue({
        updated_at: "2026-09-01T10:01:00Z",
        comments: 1,
        title: "Updated issue",
      }),
    ]);
    assert.notStrictEqual(before, after);
  });

  test("fingerprint changes when labels change", () => {
    const before = issueListFingerprint([issue()]);
    const after = issueListFingerprint([
      issue({ labels: [{ id: 7, name: "bug", color: "ff0000" }] }),
    ]);
    assert.notStrictEqual(before, after);
  });
});
