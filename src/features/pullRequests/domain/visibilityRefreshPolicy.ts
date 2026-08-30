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
  // A review draft is mirrored by the extension and the editable webview
  // context is retained while hidden, so it no longer blocks a visibility
  // refresh. Keep hasDraft in the context while this behavior is validated
  // so rollback remains a one-line policy change.
  if (context.inFlight) return "in-flight";
  if (
    context.lastRefreshAt > 0 &&
    context.now - context.lastRefreshAt < VISIBILITY_REFRESH_MIN_INTERVAL_MS
  ) {
    return "fresh";
  }
  return "refresh";
}
