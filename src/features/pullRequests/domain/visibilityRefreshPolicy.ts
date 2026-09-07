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

/**
 * Legacy compatibility policy retained while ReviewPullRequestViewProvider is
 * mechanically cleaned up. Recurring network refresh is now owned by the
 * centralized polling scheduler, so visibility alone must never initiate an
 * API refresh from the view.
 */
export function visibilityRefreshDecision(
  _context: VisibilityRefreshContext,
): VisibilityRefreshDecision {
  return "fresh";
}
