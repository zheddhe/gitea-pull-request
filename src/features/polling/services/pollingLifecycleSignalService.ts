import * as vscode from "vscode";
import { debug } from "../../../debug/outputChannel";
import type { PollingResourceKind } from "../domain/adaptivePollingPolicy";
import {
  PollingLifecycleState,
  type PollingLifecycleSnapshot,
  type PollingSurface,
} from "../domain/pollingLifecycleState";
import type { PullRequestSessionService } from "../../pullRequests/services/pullRequestSessionService";
import type { PullRequestReviewSessionService } from "../../pullRequests/services/pullRequestReviewSessionService";

export interface PollingSignalClock {
  now(): number;
}

const systemClock: PollingSignalClock = { now: () => Date.now() };

export class PollingLifecycleSignalService implements vscode.Disposable {
  private readonly state = new PollingLifecycleState();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<PollingLifecycleSnapshot>();
  private initialized = false;

  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly prSession: PullRequestSessionService,
    private readonly reviewSessions: PullRequestReviewSessionService,
    private readonly clock: PollingSignalClock = systemClock,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.state.setWindowActive(vscode.window.state.focused);
    this.syncPullRequestLifecycle();
    this.syncEditingState();

    this.disposables.push(
      vscode.window.onDidChangeWindowState((windowState) => {
        if (this.state.setWindowActive(windowState.focused)) this.emit();
      }),
      this.prSession.onDidChangeState(() => {
        const lifecycleChanged = this.syncPullRequestLifecycle();
        const editingChanged = this.syncEditingState();
        if (lifecycleChanged || editingChanged) this.emit();
      }),
      this.reviewSessions.onDidChange(() => {
        if (this.syncEditingState()) this.emit();
      }),
    );

    this.emit();
  }

  contextFor(resourceKind: PollingResourceKind, surface: PollingSurface) {
    return this.state.contextFor(resourceKind, surface, this.clock.now());
  }

  snapshot(): PollingLifecycleSnapshot {
    return this.state.snapshot(this.clock.now());
  }

  setSurfaceVisible(surface: PollingSurface, visible: boolean): void {
    if (this.state.setSurfaceVisible(surface, visible)) this.emit();
  }

  markUserAction(durationMs = 10_000): void {
    this.state.markRecentAction(this.clock.now(), durationMs);
    this.emit();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.changeEmitter.dispose();
  }

  private syncPullRequestLifecycle(): boolean {
    switch (this.prSession.current.kind) {
      case "active":
        return this.state.setLifecycle("active");
      case "creating":
        return this.state.setLifecycle("creation");
      case "merged":
        return this.state.setLifecycle("post-merge");
      case "idle":
        return this.state.setLifecycle("terminal");
    }
  }

  private syncEditingState(): boolean {
    const current = this.prSession.current;
    if (current.kind !== "active") return this.state.setEditing(false);

    const pending = this.reviewSessions.get(
      { key: current.repository.key },
      current.pullRequest.number,
    );
    const editing =
      pending.inlineComments.length > 0 ||
      pending.replies.length > 0 ||
      pending.conversationActions.length > 0;
    return this.state.setEditing(editing);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    debug(
      `[polling] lifecycle windowActive=${snapshot.windowActive} lifecycle=${snapshot.lifecycle} activity=${snapshot.activity} visible=${[...snapshot.visibleSurfaces].sort().join(",") || "none"}`,
    );
    this.changeEmitter.fire(snapshot);
  }
}
