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

  test("pauses while the user is editing", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ activity: "editing" })),
      { kind: "pause", reason: "editing" },
    );
  });

  test("accelerates after a recent user action", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ activity: "recent-action" })),
      { kind: "poll", delayMs: 2_000, reason: "recent-action" },
    );
  });

  test("slows polling when the VS Code window is inactive", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ windowActive: false })),
      { kind: "poll", delayMs: 120_000, reason: "window-inactive" },
    );
  });

  test("uses a fast cadence for visible live CI logs", () => {
    assert.deepStrictEqual(
      adaptivePollingDecision(context({ resourceKind: "ci-logs" })),
      { kind: "poll", delayMs: 2_000, reason: "active-visible" },
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
});
