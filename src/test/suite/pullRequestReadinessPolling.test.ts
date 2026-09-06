import * as assert from "assert";
import type { GiteaCombinedStatus, GiteaReview } from "../../api/types";
import {
  hasPendingChecks,
  readinessFingerprint,
} from "../../features/polling/services/pullRequestReadinessPollingService";

function status(overrides: Partial<GiteaCombinedStatus> = {}): GiteaCombinedStatus {
  return {
    state: "pending",
    total_count: 1,
    statuses: [
      {
        id: 1,
        state: "pending",
        context: "ci/test",
        description: "Running",
        target_url: "https://gitea.example.test/actions/1",
        created_at: "2026-09-06T10:00:00Z",
      },
    ],
    ...overrides,
  };
}

function review(overrides: Partial<GiteaReview> = {}): GiteaReview {
  return {
    id: 7,
    user: { login: "reviewer" } as GiteaReview["user"],
    body: "",
    state: "COMMENT",
    submitted_at: "2026-09-06T10:00:00Z",
    stale: false,
    html_url: "https://gitea.example.test/review/7",
    ...overrides,
  };
}

suite("Pull request readiness polling", () => {
  test("fingerprint is stable for identical readiness data", () => {
    assert.strictEqual(
      readinessFingerprint(status(), [review()]),
      readinessFingerprint(status(), [review()]),
    );
  });

  test("fingerprint changes when a check transitions", () => {
    const before = readinessFingerprint(status(), [review()]);
    const after = readinessFingerprint(
      status({
        state: "success",
        statuses: [
          {
            ...status().statuses[0],
            state: "success",
            description: "Passed",
          },
        ],
      }),
      [review()],
    );
    assert.notStrictEqual(before, after);
  });

  test("fingerprint changes when review state changes", () => {
    const before = readinessFingerprint(status(), [review()]);
    const after = readinessFingerprint(status(), [review({ state: "APPROVED" })]);
    assert.notStrictEqual(before, after);
  });

  test("detects aggregate and individual pending check states", () => {
    assert.strictEqual(hasPendingChecks(status()), true);
    assert.strictEqual(
      hasPendingChecks(
        status({
          state: "success",
          statuses: [{ ...status().statuses[0], state: "pending" }],
        }),
      ),
      true,
    );
  });

  test("treats completed checks as stable", () => {
    assert.strictEqual(
      hasPendingChecks(
        status({
          state: "success",
          statuses: [{ ...status().statuses[0], state: "success" }],
        }),
      ),
      false,
    );
  });
});
