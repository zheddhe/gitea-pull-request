export const VISIBILITY_REFRESH_MIN_INTERVAL_MS = 15_000;

export interface VisibilityRefreshContext {
  visible: boolean;
  busy: boolean;
  hasDraft: boolean;
  inFlight: boolean;
  lastRefreshAt: number;
  now: number;
}

export type VisibilityRefreshDecision =
  | "refresh"
  | "hidden"
  | "busy"
  | "draft"
  | "in-flight"
  | "fresh";

export function visibilityRefreshDecision(
  context: VisibilityRefreshContext,
): VisibilityRefreshDecision {
  if (!context.visible) return "hidden";
  if (context.busy) return "busy";
  if (context.hasDraft) return "draft";
  if (context.inFlight) return "in-flight";
  if (
    context.lastRefreshAt > 0 &&
    context.now - context.lastRefreshAt < VISIBILITY_REFRESH_MIN_INTERVAL_MS
  ) {
    return "fresh";
  }
  return "refresh";
}
