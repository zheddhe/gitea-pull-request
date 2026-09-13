import * as vscode from "vscode";
import type { ReviewNavigationMode } from "../domain/reviewNavigationModel";

export interface ReviewNavigationState {
  repositoryKey?: string;
  pullRequestNumber?: number;
  mode: ReviewNavigationMode;
  activeItemId?: string;
}

export type ReviewNavigationStateChangeReason =
  | "activate"
  | "mode"
  | "selection"
  | "reconcile"
  | "clear";

export interface ReviewNavigationStateChange {
  state: ReviewNavigationState;
  reason: ReviewNavigationStateChangeReason;
}

/**
 * Shared extension-host cursor for review navigation.
 *
 * Inline Review and PR Detail must project this state rather than keeping
 * independent navigation cursors. The service deliberately stores logical item
 * identities, not editor positions, so an unplaceable conversation can remain
 * active when switching away from the native diff.
 */
export class ReviewNavigationStateService implements vscode.Disposable {
  private state: ReviewNavigationState = { mode: "unresolved" };
  private readonly changeEmitter =
    new vscode.EventEmitter<ReviewNavigationStateChange>();

  readonly onDidChange = this.changeEmitter.event;

  get current(): ReviewNavigationState {
    return { ...this.state };
  }

  activate(repositoryKey: string, pullRequestNumber: number): ReviewNavigationState {
    if (
      this.state.repositoryKey === repositoryKey &&
      this.state.pullRequestNumber === pullRequestNumber
    ) {
      return this.current;
    }
    return this.store(
      {
        repositoryKey,
        pullRequestNumber,
        mode: this.state.mode,
      },
      "activate",
    );
  }

  setMode(mode: ReviewNavigationMode): ReviewNavigationState {
    if (this.state.mode === mode) return this.current;
    return this.store(
      {
        ...this.state,
        mode,
        activeItemId: undefined,
      },
      "mode",
    );
  }

  select(itemId: string | undefined): ReviewNavigationState {
    if (this.state.activeItemId === itemId) return this.current;
    return this.store({ ...this.state, activeItemId: itemId }, "selection");
  }

  reconcile(validItemIds: Iterable<string>): ReviewNavigationState {
    const activeItemId = this.state.activeItemId;
    if (!activeItemId) return this.current;
    const valid = new Set(validItemIds);
    if (valid.has(activeItemId)) return this.current;
    return this.store({ ...this.state, activeItemId: undefined }, "reconcile");
  }

  clear(): ReviewNavigationState {
    if (
      this.state.repositoryKey === undefined &&
      this.state.pullRequestNumber === undefined &&
      this.state.activeItemId === undefined
    ) {
      return this.current;
    }
    return this.store({ mode: this.state.mode }, "clear");
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private store(
    state: ReviewNavigationState,
    reason: ReviewNavigationStateChangeReason,
  ): ReviewNavigationState {
    this.state = { ...state };
    const snapshot = this.current;
    this.changeEmitter.fire({ state: snapshot, reason });
    return snapshot;
  }
}
