import * as vscode from "vscode";
import type { PollingSurface } from "../domain/pollingLifecycleState";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";

export class PollingVisibilityWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly delegate: vscode.WebviewViewProvider,
    private readonly surface: PollingSurface,
    private readonly signals: Pick<PollingLifecycleSignalService, "setSurfaceVisible">,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.signals.setSurfaceVisible(this.surface, webviewView.visible);
    this.disposables.push(
      webviewView.onDidChangeVisibility(() => {
        this.signals.setSurfaceVisible(this.surface, webviewView.visible);
      }),
    );
    return this.delegate.resolveWebviewView(webviewView, context, token);
  }

  dispose(): void {
    this.signals.setSurfaceVisible(this.surface, false);
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}
