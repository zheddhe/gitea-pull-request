import * as assert from "assert";
import type {
  GiteaComment,
  GiteaPullRequest,
  GiteaReview,
  GiteaReviewComment,
} from "../../api/types";
import { pullRequestDetailFingerprint } from "../../features/pullRequests/domain/pullRequestDetailPolling";

function snapshot() {
  return {
    pullRequest: {
      number: 9,
      state: "open",
      merged: false,
      title: "Improve polling",
      body: "Description",
      mergeable: true,
      base: { sha: "base-sha" },
      head: { sha: "head-sha" },
      labels: [{ id: 1, name: "review", color: "ffaa00" }],
      assignees: [{ login: "alice" }],
      milestone: { id: 3 },
    } as unknown as GiteaPullRequest,
    comments: [
      {
        id: 10,
        updated_at: "2026-09-06T10:00:00Z",
        user: { login: "alice" },
        body: "Looks useful",
      } as unknown as GiteaComment,
    ],
    reviews: [
      {
        id: 20,
        user: { login: "bob" },
        state: "COMMENT",
        submitted_at: "2026-09-06T10:01:00Z",
        stale: false,
        body: "Review body",
      } as unknown as GiteaReview,
    ],
    reviewComments: [
      {
        id: 30,
        updated_at: "2026-09-06T10:02:00Z",
        user: { login: "bob" },
        body: "Inline note",
        path: "src/index.ts",
        position: 12,
      } as unknown as GiteaReviewComment,
    ],
  };
}

suite("Pull request detail polling", () => {
  test("fingerprint is stable for equivalent remote state", () => {
    assert.strictEqual(
      pullRequestDetailFingerprint(snapshot()),
      pullRequestDetailFingerprint(snapshot()),
    );
  });

  test("fingerprint changes for discussion updates", () => {
    const before = snapshot();
    const after = snapshot();
    after.comments = [
      {
        ...after.comments[0],
        body: "Updated discussion",
        updated_at: "2026-09-06T10:03:00Z",
      } as unknown as GiteaComment,
    ];
    assert.notStrictEqual(
      pullRequestDetailFingerprint(before),
      pullRequestDetailFingerprint(after),
    );
  });

  test("fingerprint changes for review lifecycle updates", () => {
    const before = snapshot();
    const after = snapshot();
    after.reviews = [
      { ...after.reviews[0], state: "APPROVED" } as unknown as GiteaReview,
    ];
    assert.notStrictEqual(
      pullRequestDetailFingerprint(before),
      pullRequestDetailFingerprint(after),
    );
  });

  test("fingerprint changes for native inline conversation updates", () => {
    const before = snapshot();
    const after = snapshot();
    after.reviewComments = [
      {
        ...after.reviewComments[0],
        resolver: { login: "alice" },
        updated_at: "2026-09-06T10:04:00Z",
      } as unknown as GiteaReviewComment,
    ];
    assert.notStrictEqual(
      pullRequestDetailFingerprint(before),
      pullRequestDetailFingerprint(after),
    );
  });

  test("fingerprint changes when PR metadata or head changes", () => {
    const before = snapshot();
    const after = snapshot();
    after.pullRequest = {
      ...after.pullRequest,
      title: "Updated title",
      head: { ...after.pullRequest.head, sha: "next-head" },
    } as GiteaPullRequest;
    assert.notStrictEqual(
      pullRequestDetailFingerprint(before),
      pullRequestDetailFingerprint(after),
    );
  });
});
