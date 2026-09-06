export type PollingResourceKind =
  | "pull-request"
  | "pull-request-readiness"
  | "ci-runs"
  | "ci-job"
  | "ci-logs"
  | "issues";

export type PollingActivity = "idle" | "recent-action" | "editing";
export type PollingLifecycle = "active" | "terminal" | "creation" | "post-merge";

export interface PollingContext {
  resourceKind: PollingResourceKind;
  windowActive: boolean;
  visible: boolean;
  activity: PollingActivity;
  lifecycle: PollingLifecycle;
  unchangedCount: number;
  inFlight: boolean;
}

export type PollingDecision =
  | { kind: "poll"; delayMs: number; reason: string }
  | { kind: "pause"; reason: string };

const ACTIVE_DELAYS_MS: Record<PollingResourceKind, number> = {
  "pull-request": 15_000,
  "pull-request-readiness": 10_000,
  "ci-runs": 10_000,
  "ci-job": 5_000,
  "ci-logs": 2_000,
  issues: 60_000,
};

const TERMINAL_DELAY_MS = 5 * 60_000;
const INACTIVE_WINDOW_DELAY_MS = 2 * 60_000;
const RECENT_ACTION_DELAY_MS = 2_000;
const HIDDEN_MULTIPLIER = 4;
const MAX_BACKOFF_MULTIPLIER = 4;

export function adaptivePollingDecision(context: PollingContext): PollingDecision {
  if (context.inFlight) {
    return { kind: "pause", reason: "in-flight" };
  }

  if (!context.windowActive) {
    return {
      kind: "poll",
      delayMs: INACTIVE_WINDOW_DELAY_MS,
      reason: "window-inactive",
    };
  }

  if (context.activity === "editing") {
    return { kind: "pause", reason: "editing" };
  }

  if (context.activity === "recent-action" && context.lifecycle === "active") {
    return {
      kind: "poll",
      delayMs: context.visible ? RECENT_ACTION_DELAY_MS : RECENT_ACTION_DELAY_MS * 2,
      reason: "recent-action",
    };
  }

  const baseDelay =
    context.lifecycle === "terminal" || context.lifecycle === "post-merge"
      ? TERMINAL_DELAY_MS
      : ACTIVE_DELAYS_MS[context.resourceKind];

  const visibilityMultiplier = context.visible ? 1 : HIDDEN_MULTIPLIER;
  const backoffMultiplier = Math.min(
    MAX_BACKOFF_MULTIPLIER,
    2 ** Math.min(context.unchangedCount, 2),
  );

  return {
    kind: "poll",
    delayMs: baseDelay * visibilityMultiplier * backoffMultiplier,
    reason:
      context.lifecycle === "terminal" || context.lifecycle === "post-merge"
        ? "stable-lifecycle"
        : context.visible
          ? context.unchangedCount > 0
            ? "backoff"
            : "active-visible"
          : "hidden",
  };
}
