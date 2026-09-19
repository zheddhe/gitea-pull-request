import * as assert from "assert";
import type {
  GiteaCombinedStatus,
  GiteaPullRequest,
  GiteaReview,
} from "../../api/types";
import { conflictResolutionGuidanceDecision } from "../../features/pullRequests/services/conflictResolutionCoordinator";
suite("ConflictResolutionCoordinator", () => {
  test("does not offer conflict resolution for WIP even when Gitea reports mergeable=false", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ title: "WIP: still working", mergeable: false }),
        status("success", ["success"]),
        [],
        { user_can_merge: true },
      ),
      "non-git-blocker",
    );
  });

  test("does not offer conflict resolution when required approvals are missing", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: false }),
        status("success", ["success"]),
        [],
        { user_can_merge: true, required_approvals: 1 },
      ),
      "non-git-blocker",
    );
  });

  test("does not offer conflict resolution when checks are pending or failed", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: false }),
        status("pending", ["pending"]),
        [review("alice", "APPROVED")],
        { user_can_merge: true, required_approvals: 1 },
      ),
      "non-git-blocker",
    );
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: false }),
        status("failure", ["failure"]),
        [review("alice", "APPROVED")],
        { user_can_merge: true, required_approvals: 1 },
      ),
      "non-git-blocker",
    );
  });

  test("does not offer conflict resolution when mergeability is unknown or mergeable", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: undefined }),
        status("success", ["success"]),
        [],
        { user_can_merge: true },
      ),
      "not-conflicting",
    );
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: true }),
        status("success", ["success"]),
        [],
        { user_can_merge: true },
      ),
      "not-conflicting",
    );
  });

  test("does not offer conflict resolution for permission blockers", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: false }),
        status("success", ["success"]),
        [],
        { user_can_merge: false },
      ),
      "non-git-blocker",
    );
  });

  test("does not offer conflict resolution for no-content pull requests", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({
          mergeable: false,
          changed_files: 0,
          additions: 0,
          deletions: 0,
        }),
        status("success", ["success"]),
        [],
        { user_can_merge: true },
      ),
      "non-git-blocker",
    );
  });

  test("offers conflict resolution only when mergeable=false remains the sole blocker", () => {
    assert.strictEqual(
      conflictResolutionGuidanceDecision(
        pullRequest({ mergeable: false }),
        status("success", ["success"]),
        [review("alice", "APPROVED")],
        { user_can_merge: true, required_approvals: 1 },
      ),
      "technical-conflict",
    );
  });
});

function status(
  state: GiteaCombinedStatus["state"],
  checkStates: GiteaCombinedStatus["statuses"][number]["state"][],
): GiteaCombinedStatus {
  return {
    state,
    total_count: checkStates.length,
    statuses: checkStates.map((checkState, index) => ({
      id: index + 1,
      state: checkState,
      context: `check-${index + 1}`,
      description: "",
      target_url: "",
      created_at: "",
    })),
  };
}

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
    title: "Feature work",
    body: "",
    state: "open",
    html_url: "https://gitea.example/owner/repo/pulls/42",
    user,
    head: {
      label: "owner:feature",
      ref: "feature",
      sha: "abc",
      repo: repository,
    },
    base: {
      label: "owner:main",
      ref: "main",
      sha: "def",
      repo: repository,
    },
    merged: false,
    mergeable: true,
    changed_files: 1,
    additions: 1,
    deletions: 0,
    created_at: "",
    updated_at: "",
    comments: 0,
    review_comments: 0,
    ...overrides,
  };
}

function review(
  login: string,
  state: GiteaReview["state"],
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
    submitted_at: "2026-09-19T00:00:00Z",
    stale: false,
    html_url: "",
  };
}
