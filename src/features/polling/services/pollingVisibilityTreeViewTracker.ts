import * as vscode from "vscode";
import type { PollingSurface } from "../domain/pollingLifecycleState";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";

/**
 * Aggregates visibility for one logical polling surface represented by one or
 * more VS Code TreeViews. The surface is visible while any tracked TreeView is
 * visible.
 */
export class PollingVisibilityTreeViewTracker implements vscode.Disposable {
  private readonly views = new Set<vscode.TreeView<unknown>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly surface: PollingSurface,
    private readonly signals: Pick<PollingLifecycleSignalService, "setSurfaceVisible">,
  ) {}

  track<T>(view: vscode.TreeView<T>): void {
    const tracked = view as vscode.TreeView<unknown>;
    this.views.add(tracked);
    this.disposables.push(
      view.onDidChangeVisibility(() => this.sync()),
      view.onDidDispose(() => {
        this.views.delete(tracked);
        this.sync();
      }),
    );
    this.sync();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.views.clear();
    this.signals.setSurfaceVisible(this.surface, false);
  }

  private sync(): void {
    this.signals.setSurfaceVisible(
      this.surface,
      [...this.views].some((view) => view.visible),
    );
  }
}
