import * as assert from "assert";
import type {
  GiteaCombinedStatus,
  GiteaPullRequest,
  GiteaReview,
} from "../../api/types";
import {
  evaluateMergeReadiness,
  preferredMergeMethod,
  readyForReviewTitle,
  summarizeEffectiveReviews,
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

  test("does not misreport a WIP mergeable=false signal as a server conflict", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ title: "WIP: phase 3", mergeable: false }),
      combinedStatus("success"),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(readiness.blockingReasons.some((reason) => reason.includes("Work In Progress")));
    assert.ok(
      !readiness.blockingReasons.some((reason) => reason.includes("Gitea reports")),
    );
  });

  test("removes Gitea WIP markers when marking a pull request ready", () => {
    assert.strictEqual(readyForReviewTitle("WIP: Rework PR"), "Rework PR");
    assert.strictEqual(readyForReviewTitle("[WIP] Rework PR"), "Rework PR");
    assert.strictEqual(readyForReviewTitle("Normal PR"), "Normal PR");
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

  test("does not misreport no-delta mergeable=false as a server conflict", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({
        mergeable: false,
        changed_files: 0,
        additions: 0,
        deletions: 0,
      }),
      combinedStatus("success"),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(readiness.blockingReasons.some((reason) => reason.includes("No changes to merge")));
    assert.ok(!readiness.blockingReasons.some((reason) => reason.includes("Gitea reports")));
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
          reason.includes("Gitea reports") &&
          reason.includes("server-side mergeability blockers"),
      ),
    );
  });

  test("warns when Gitea does not report mergeability", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: undefined }),
      combinedStatus("success"),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, true);
    assert.ok(
      readiness.warnings.some((warning) =>
        warning.includes("Mergeability is not reported"),
      ),
    );
  });

  test("blocks merge when the current user is not allowed to merge", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("success"),
      [],
      { user_can_merge: false },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(
      readiness.blockingReasons.some((reason) =>
        reason.includes("not allowed to merge"),
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

  test("blocks pending checks", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("pending"),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.ok(
      readiness.blockingReasons.some((reason) =>
        reason.includes("still pending"),
      ),
    );
  });

  test("does not invent a pending blocker when no checks are reported", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      emptyCombinedStatus(),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, true);
    assert.strictEqual(readiness.ciLabel, "Checks: none");
    assert.ok(
      !readiness.blockingReasons.some((reason) => reason.includes("pending")),
    );
  });

  test("blocks when branch protection requires checks but none have reported", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      emptyCombinedStatus(),
      [],
      { user_can_merge: true, enable_status_check: true },
    );

    assert.strictEqual(readiness.canMerge, false);
    assert.strictEqual(readiness.ciLabel, "Checks: none");
    assert.ok(
      readiness.blockingReasons.some((reason) =>
        reason.includes("requires status checks"),
      ),
    );
  });

  test("keeps warning checks non-blocking", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("warning"),
      [],
      { user_can_merge: true },
    );

    assert.strictEqual(readiness.canMerge, true);
    assert.ok(
      readiness.warnings.some((warning) =>
        warning.includes("completed with warnings"),
      ),
    );
  });

  test("warns when required status checks cannot be read", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      undefined,
      [],
      { user_can_merge: true, enable_status_check: true },
    );

    assert.strictEqual(readiness.canMerge, true);
    assert.ok(
      readiness.warnings.some((warning) =>
        warning.includes("combined status could not be read"),
      ),
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

  test("uses only the latest review from each user", () => {
    const readiness = evaluateMergeReadiness(
      pullRequest({ mergeable: true }),
      combinedStatus("success"),
      [
        review("alice", "REQUEST_CHANGES", {
          id: 1,
          submitted_at: "2026-08-16T10:00:00Z",
        }),
        review("alice", "APPROVED", {
          id: 2,
          submitted_at: "2026-08-16T11:00:00Z",
        }),
      ],
      { user_can_merge: true, required_approvals: 1 },
    );

    assert.strictEqual(readiness.canMerge, true);
    assert.ok(readiness.reviewLabel.includes("1 approval / 1 required"));
    assert.ok(!readiness.reviewLabel.includes("requesting changes"));
  });

  test("effective review state lets a newer change request supersede approval", () => {
    const summary = summarizeEffectiveReviews([
      review("alice", "APPROVED", {
        id: 1,
        submitted_at: "2026-08-16T10:00:00Z",
      }),
      review("alice", "REQUEST_CHANGES", {
        id: 2,
        submitted_at: "2026-08-16T11:00:00Z",
      }),
    ]);

    assert.deepStrictEqual(summary, {
      state: "changes_requested",
      approvals: 0,
      changesRequested: 1,
    });
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
  return {
    state,
    statuses: [
      {
        id: 1,
        state,
        context: "ci/test",
        description: "",
        target_url: "",
        created_at: "2026-08-16T00:00:00Z",
      },
    ],
    total_count: 1,
  };
}

function emptyCombinedStatus(): GiteaCombinedStatus {
  return { state: "pending", statuses: [], total_count: 0 };
}

function review(
  login: string,
  state: GiteaReview["state"],
  overrides: Partial<GiteaReview> = {},
): GiteaReview {
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
    ...overrides,
  };
}
