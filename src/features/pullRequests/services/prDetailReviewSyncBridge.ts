import * as vscode from "vscode";
import type { PendingReviewSession } from "../domain/pendingReviewSession";
import { PRDetailPanel } from "../../../views/prDetailPanel";

type PRDetailPanelInstance = {
  panel?: vscode.WebviewPanel;
};

type PRDetailPanelRegistry = {
  panels?: Map<string, PRDetailPanelInstance>;
};

export type PRDetailMessageSink = Pick<vscode.Webview, "postMessage">;
export type PRDetailMessageSinkResolver = (
  repositoryKey: string,
  pullRequestNumber: number,
) => PRDetailMessageSink | undefined;

/**
 * Targeted extension-host -> PR Detail synchronization for review state.
 *
 * PR Detail already knows how to apply pendingReviewSessionChanged without a
 * destructive HTML reload. This bridge only locates the already-open panel and
 * posts the normalized session snapshot to it.
 *
 * The panel registry is currently owned by PRDetailPanel. Keeping the registry
 * lookup isolated here prevents review services from depending on webview
 * implementation details while the legacy panel is progressively migrated to
 * explicit injected state sources.
 */
export class PRDetailReviewSyncBridge {
  constructor(
    private readonly resolveSink: PRDetailMessageSinkResolver =
      resolveOpenPRDetailSink,
  ) {}

  async publishPendingSession(
    repositoryKey: string,
    pullRequestNumber: number,
    session: PendingReviewSession,
  ): Promise<boolean> {
    const sink = this.resolveSink(repositoryKey, pullRequestNumber);
    if (!sink) return false;
    return Promise.resolve(
      sink.postMessage({
        type: "pendingReviewSessionChanged",
        session,
      }),
    );
  }
}

function resolveOpenPRDetailSink(
  repositoryKey: string,
  pullRequestNumber: number,
): PRDetailMessageSink | undefined {
  const registry = PRDetailPanel as unknown as PRDetailPanelRegistry;
  const instance = registry.panels?.get(
    `${repositoryKey}::pr:${pullRequestNumber}`,
  );
  return instance?.panel?.webview;
}
