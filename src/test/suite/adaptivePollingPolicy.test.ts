import * as assert from "assert";
import {
  adaptivePollingDecision,
  type PollingContext,
} from "../../features/polling/domain/adaptivePollingPolicy";

function context(overrides: Partial<PollingContext> = {}): PollingContext {
  return {
    resourceKind: "pull-request",
    windowActive: true,
    visible: true,
    activity: "idle",
    lifecycle: "active",
    unchangedCount: 0,
    inFlight: false,
    ...overrides,
  };
}

suite("adaptivePollingPolicy", () => {
  test("pauses while a resource is already in flight", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ inFlight: true })),
      { kind: "pause", reason: "in-flight" },
    );
  });

  test("pauses broad active PR refresh while the user is editing", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ activity: "editing" })),
      { kind: "pause", reason: "editing" },
    );
  });

  test("pauses PR detail polling while local editable UI is active", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ resourceKind: "pull-request-detail", activity: "editing" }),
      ),
      { kind: "pause", reason: "editing" },
    );
  });

  test("uses active PR cadence for clean visible PR detail", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ resourceKind: "pull-request-detail" })),
      { kind: "poll", delayMs: 15_000, reason: "active-visible" },
    );
  });

  test("does not pause CI polling because a PR review is being edited", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ resourceKind: "ci-runs", activity: "editing" }),
      ),
      { kind: "poll", delayMs: 10_000, reason: "active-visible" },
    );
  });

  test("keeps pending readiness live while a PR review is being edited", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({
          resourceKind: "pull-request-readiness",
          lifecycle: "pending",
          activity: "editing",
          unchangedCount: 3,
        }),
      ),
      { kind: "poll", delayMs: 5_000, reason: "pending-live" },
    );
  });

  test("accelerates after a recent user action", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ activity: "recent-action" })),
      { kind: "poll", delayMs: 2_000, reason: "recent-action" },
    );
  });

  test("does not apply recent-action acceleration while the window is inactive", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ activity: "recent-action", windowActive: false }),
      ),
      { kind: "poll", delayMs: 120_000, reason: "window-inactive" },
    );
  });

  test("slows active polling when the VS Code window is inactive", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ windowActive: false })),
      { kind: "poll", delayMs: 120_000, reason: "window-inactive" },
    );
  });

  test("never speeds up a terminal resource when the window becomes inactive", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ lifecycle: "terminal", windowActive: false }),
      ),
      { kind: "poll", delayMs: 300_000, reason: "window-inactive" },
    );
  });

  test("preserves hidden and backoff modifiers while the window is inactive", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ windowActive: false, visible: false, unchangedCount: 2 }),
      ),
      { kind: "poll", delayMs: 240_000, reason: "window-inactive" },
    );
  });

  test("uses a fast cadence for visible live CI logs", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ resourceKind: "ci-logs" })),
      { kind: "poll", delayMs: 2_000, reason: "active-visible" },
    );
  });

  test("keeps pending CI runs at five seconds without unchanged backoff", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ resourceKind: "ci-runs", lifecycle: "pending", unchangedCount: 4 }),
      ),
      { kind: "poll", delayMs: 5_000, reason: "pending-live" },
    );
  });

  test("keeps pending pull request checks at five seconds without unchanged backoff", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({
          resourceKind: "pull-request-readiness",
          lifecycle: "pending",
          unchangedCount: 4,
        }),
      ),
      { kind: "poll", delayMs: 5_000, reason: "pending-live" },
    );
  });

  test("slows pending resources while hidden", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ resourceKind: "ci-runs", lifecycle: "pending", visible: false }),
      ),
      { kind: "poll", delayMs: 20_000, reason: "hidden" },
    );
  });

  test("backs off exponentially when nothing changes", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ unchangedCount: 2 })),
      { kind: "poll", delayMs: 60_000, reason: "backoff" },
    );
  });

  test("slows hidden resources", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ visible: false })),
      { kind: "poll", delayMs: 60_000, reason: "hidden" },
    );
  });

  test("uses a very slow cadence for terminal resources", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ lifecycle: "terminal" })),
      { kind: "poll", delayMs: 300_000, reason: "stable-lifecycle" },
    );
  });

  test("applies hidden slowdown to terminal resources", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(
        context({ lifecycle: "terminal", visible: false }),
      ),
      { kind: "poll", delayMs: 1_200_000, reason: "stable-lifecycle" },
    );
  });
});
