import * as vscode from "vscode";
import type { PollingSurface } from "../domain/pollingLifecycleState";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";

/**
 * Aggregates visibility for one logical polling surface represented by one or
 * more VS Code TreeViews. The surface is visible while any tracked TreeView is
 * visible. TreeView disposal is owned by the extension subscription set; this
 * tracker only observes visibility and is disposed alongside those views.
 */
export class PollingVisibilityTreeViewTracker implements vscode.Disposable {
  private readonly views = new Set<vscode.TreeView<unknown>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly surface: PollingSurface,
    private readonly signals: Pick<PollingLifecycleSignalService, "setSurfaceVisible">,
  ) {}

  track<T>(view: vscode.TreeView<T>): void {
    this.views.add(view as vscode.TreeView<unknown>);
    this.disposables.push(view.onDidChangeVisibility(() => this.sync()));
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
