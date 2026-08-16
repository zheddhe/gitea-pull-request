import * as assert from "assert";
import type {
  GiteaCombinedStatus,
  GiteaPullRequest,
  GiteaReview,
} from "../../api/types";
import {
  evaluateMergeReadiness,
  preferredMergeMethod,
  supportedMergeMethods,
} from "../../features/pullRequests/domain/reviewPullRequestModel";

suite("reviewPullRequestModel", () => {
  test("blocks WIP pull requests", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ title: "WIP: phase 3", mergeable: true }),
      combinedStatus("success"),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(
      readiness.blockingReasons.some((reason) =>
        reason.includes("Work In Progress"),
      ),
    );
  });

  test("blocks pull requests whose head is already contained in base", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({
        mergeable: true,
        changed_files: 0,
        additions: 0,
        deletions: 0,
      }),
      combinedStatus("success"),
      [review("alice", "APPROVED")],
      { user_can_merge: true, required_approvals: 1 },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(
      readiness.blockingReasons.some((reason) =>
        reason.includes("No changes to merge"),
      ),
    );
  });

  test("blocks pull requests Gitea reports as non-mergeable", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: false }),
      combinedStatus("success"),
      [review("alice", "APPROVED")],
      { user_can_merge: true, required_approvals: 1 },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(
      readiness.blockingReasons.some(
        (reason) =>
          reason.includes("cannot be merged automatically") &&
          reason.includes("conflicts with the target branch"),
      ),
    );
  });

  test("blocks failed checks and requested changes", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("failure"),
      [review("alice", "REQUEST_CHANGES")],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(readiness.blockingReasons.some((reason) => reason.includes("failure")));
    assert.ok(
      readiness.blockingReasons.some((reason) => reason.includes("requests changes")),
    );
  });

  test("requires configured approvals", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("success"),
      [review("alice", "APPROVED")],
      { user_can_merge: true, required_approvals: 2 },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(readiness.reviewLabel.includes("1 approval / 2 required"));
  });

  test("accepts merge when observable blockers are clear", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("success"),
      [review("alice", "APPROVED")],
      { user_can_merge: true, required_approvals: 1 },
    );

    assert.strictEqual(readiness.canMerge, true);
    assert.deepStrictEqual(readiness.blockingReasons, []);
  });

  test("filters disabled repository merge methods", () => {
    const methods = supportedMergeMethods({
      allow_merge_commits: true,
      allow_squash_merge: false,
      allow_rebase: true,
    });

    assert.deepStrictEqual(methods, ["merge", "rebase"]);
  });

  test("persisted merge method wins when still supported", () => {
    assert.strictEqual(
      preferredMergeMethod(["merge", "squash"], "squash", "merge"),
      "squash",
    );
  });
});

function pullRequest(
  overrides: Partial<GiteaPullRequest> = {},
): GiteaPullRequest {
  const user = {
    id: 1,
    login: "author",
    full_name: "Author",
    email: "author@example.test",
    avatar_url: "",
  };
  const repository = {
    id: 1,
    name: "repo",
    full_name: "owner/repo",
    owner: user,
    html_url: "https://gitea.example/owner/repo",
    default_branch: "main",
    private: false,
    fork: false,
  };
  return {
    id: 1,
    number: 42,
    title: "Phase 3",
    body: "",
    state: "open",
    html_url: "https://gitea.example/owner/repo/pulls/42",
    user,
    head: { label: "owner:feature", ref: "feature", sha: "abc", repo: repository },
    base: { label: "owner:main", ref: "main", sha: "def", repo: repository },
    merged: false,
    mergeable: true,
    created_at: "2026-08-16T00:00:00Z",
    updated_at: "2026-08-16T00:00:00Z",
    comments: 0,
    review_comments: 0,
    ...overrides,
  };
}

function combinedStatus(
  state: GiteaCombinedStatus["state"],
): GiteaCombinedStatus {
  return { state, statuses: [], total_count: 0 };
}

function review(login: string, state: GiteaReview["state"]): GiteaReview {
  return {
    id: 1,
    user: {
      id: 2,
      login,
      full_name: login,
      email: `${login}@example.test`,
      avatar_url: "",
    },
    body: "",
    state,
    submitted_at: "2026-08-16T00:00:00Z",
    stale: false,
    html_url: "",
  };
}
