import type {
  PollingActivity,
  PollingContext,
  PollingLifecycle,
  PollingResourceKind,
} from "./adaptivePollingPolicy";

export type PollingSurface =
  | "pull-request-review"
  | "pull-request-create"
  | "pull-request-post-merge"
  | "ci-runs"
  | "issues"
  | "live-log";

export interface PollingLifecycleSnapshot {
  windowActive: boolean;
  lifecycle: PollingLifecycle;
  activity: PollingActivity;
  visibleSurfaces: ReadonlySet<PollingSurface>;
}

export class PollingLifecycleState {
  private windowActive = true;
  private lifecycle: PollingLifecycle = "terminal";
  private editing = false;
  private recentActionUntil = 0;
  private readonly visibleSurfaces = new Set<PollingSurface>();

  setWindowActive(active: boolean): boolean {
    if (this.windowActive === active) return false;
    this.windowActive = active;
    return true;
  }

  setLifecycle(lifecycle: PollingLifecycle): boolean {
    if (this.lifecycle === lifecycle) return false;
    this.lifecycle = lifecycle;
    return true;
  }

  setEditing(editing: boolean): boolean {
    if (this.editing === editing) return false;
    this.editing = editing;
    return true;
  }

  setSurfaceVisible(surface: PollingSurface, visible: boolean): boolean {
    const wasVisible = this.visibleSurfaces.has(surface);
    if (wasVisible === visible) return false;
    if (visible) this.visibleSurfaces.add(surface);
    else this.visibleSurfaces.delete(surface);
    return true;
  }

  markRecentAction(now: number, durationMs = 10_000): void {
    this.recentActionUntil = Math.max(this.recentActionUntil, now + durationMs);
  }

  snapshot(now: number): PollingLifecycleSnapshot {
    return {
      windowActive: this.windowActive,
      lifecycle: this.lifecycle,
      activity: this.activity(now),
      visibleSurfaces: new Set(this.visibleSurfaces),
    };
  }

  contextFor(
    resourceKind: PollingResourceKind,
    surface: PollingSurface,
    now: number,
  ): Omit<PollingContext, "unchangedCount" | "inFlight"> {
    return {
      resourceKind,
      windowActive: this.windowActive,
      visible: this.visibleSurfaces.has(surface),
      activity: this.activity(now),
      lifecycle: this.lifecycle,
    };
  }

  private activity(now: number): PollingActivity {
    if (this.editing) return "editing";
    if (now < this.recentActionUntil) return "recent-action";
    return "idle";
  }
}
