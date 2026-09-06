import * as assert from "assert";
import type { GiteaPullRequest } from "../../api/types";
import {
  lifecycleForPullRequest,
  pullRequestFingerprint,
} from "../../features/polling/services/activePullRequestPollingService";

function pullRequest(
  overrides: Partial<GiteaPullRequest> = {},
): GiteaPullRequest {
  return {
    id: 9,
    number: 9,
    title: "PR",
    body: "",
    state: "open",
    html_url: "https://gitea.example.test/owner/repo/pulls/9",
    user: {} as GiteaPullRequest["user"],
    head: {
      label: "owner:feature",
      ref: "feature",
      sha: "head-1",
      repo: {} as GiteaPullRequest["head"]["repo"],
    },
    base: {
      label: "owner:main",
      ref: "main",
      sha: "base-1",
      repo: {} as GiteaPullRequest["base"]["repo"],
    },
    merged: false,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    comments: 0,
    review_comments: 0,
    ...overrides,
  };
}

suite("Active pull request polling", () => {
  test("keeps open unmerged pull requests active", () => {
    assert.strictEqual(lifecycleForPullRequest(pullRequest()), "active");
  });

  test("treats closed or merged pull requests as terminal", () => {
    assert.strictEqual(
      lifecycleForPullRequest(pullRequest({ state: "closed" })),
      "terminal",
    );
    assert.strictEqual(
      lifecycleForPullRequest(pullRequest({ merged: true })),
      "terminal",
    );
  });

  test("fingerprint changes for server-visible review state changes", () => {
    const before = pullRequestFingerprint(pullRequest());
    const after = pullRequestFingerprint(
      pullRequest({
        updated_at: "2026-09-01T10:01:00Z",
        review_comments: 1,
      }),
    );
    assert.notStrictEqual(before, after);
  });

  test("fingerprint changes when the head commit moves", () => {
    const before = pullRequestFingerprint(pullRequest());
    const after = pullRequestFingerprint(
      pullRequest({
        head: {
          ...pullRequest().head,
          sha: "head-2",
        },
      }),
    );
    assert.notStrictEqual(before, after);
  });

  test("fingerprint ignores title-only presentation changes", () => {
    const before = pullRequestFingerprint(pullRequest());
    const after = pullRequestFingerprint(pullRequest({ title: "Renamed" }));
    assert.strictEqual(before, after);
  });
});
