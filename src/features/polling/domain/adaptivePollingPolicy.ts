export type PollingResourceKind =
  | "pull-request"
  | "pull-request-readiness"
  | "ci-runs"
  | "ci-job"
  | "ci-logs"
  | "issues";

export type PollingActivity = "idle" | "recent-action" | "editing";
export type PollingLifecycle =
  | "active"
  | "pending"
  | "terminal"
  | "creation"
  | "post-merge";

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

const PENDING_LIVE_DELAYS_MS: Partial<Record<PollingResourceKind, number>> = {
  "pull-request-readiness": 5_000,
  "ci-runs": 5_000,
  "ci-job": 5_000,
  "ci-logs": 2_000,
};

const TERMINAL_DELAY_MS = 5 * 60_000;
const INACTIVE_WINDOW_MIN_DELAY_MS = 2 * 60_000;
const RECENT_ACTION_DELAY_MS = 2_000;
const HIDDEN_MULTIPLIER = 4;
const MAX_BACKOFF_MULTIPLIER = 4;

export function adaptivePollingDecision(context: PollingContext): PollingDecision {
  if (context.inFlight) {
    return { kind: "pause", reason: "in-flight" };
  }

  if (context.activity === "editing" && isEditSensitive(context.resourceKind)) {
    return { kind: "pause", reason: "editing" };
  }

  if (
    context.windowActive &&
    context.activity === "recent-action" &&
    (context.lifecycle === "active" || context.lifecycle === "pending")
  ) {
    return {
      kind: "poll",
      delayMs: context.visible ? RECENT_ACTION_DELAY_MS : RECENT_ACTION_DELAY_MS * 2,
      reason: "recent-action",
    };
  }

  const pendingLiveDelay =
    context.lifecycle === "pending"
      ? PENDING_LIVE_DELAYS_MS[context.resourceKind]
      : undefined;
  if (pendingLiveDelay !== undefined) {
    const visibilityDelay = context.visible
      ? pendingLiveDelay
      : pendingLiveDelay * HIDDEN_MULTIPLIER;
    const delayMs = context.windowActive
      ? visibilityDelay
      : Math.max(visibilityDelay, INACTIVE_WINDOW_MIN_DELAY_MS);
    return {
      kind: "poll",
      delayMs,
      reason: context.windowActive
        ? context.visible
          ? "pending-live"
          : "hidden"
        : "window-inactive",
    };
  }

  const stableLifecycle =
    context.lifecycle === "terminal" || context.lifecycle === "post-merge";
  const baseDelay = stableLifecycle
    ? TERMINAL_DELAY_MS
    : ACTIVE_DELAYS_MS[context.resourceKind];
  const visibilityMultiplier = context.visible ? 1 : HIDDEN_MULTIPLIER;
  const backoffMultiplier = Math.min(
    MAX_BACKOFF_MULTIPLIER,
    2 ** Math.min(context.unchangedCount, 2),
  );

  const adaptiveDelay = baseDelay * visibilityMultiplier * backoffMultiplier;
  const delayMs = context.windowActive
    ? adaptiveDelay
    : Math.max(adaptiveDelay, INACTIVE_WINDOW_MIN_DELAY_MS);

  return {
    kind: "poll",
    delayMs,
    reason: !context.windowActive
      ? "window-inactive"
      : stableLifecycle
        ? "stable-lifecycle"
        : context.visible
          ? context.unchangedCount > 0
            ? "backoff"
            : "active-visible"
          : "hidden",
  };
}

function isEditSensitive(resourceKind: PollingResourceKind): boolean {
  // The active PR snapshot can cause broad view/session re-rendering, so it is
  // paused while a pending review is being edited. Readiness polling is safe:
  // the Review view retains its draft body while checks/reviews are updated.
  return resourceKind === "pull-request";
}
