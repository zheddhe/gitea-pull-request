import * as vscode from "vscode";
import type { PendingReviewSession } from "../domain/pendingReviewSession";
import type { ReviewNavigationState } from "./reviewNavigationStateService";
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
 * destructive HTML reload. Navigation uses the same bridge so Inline Review
 * and PR Detail observe one extension-host logical cursor rather than keeping
 * independent surface-local cursors.
 *
 * PRDetailPanel still owns its legacy static panel registry. Keep that lookup
 * isolated here so the shared review model and navigation services do not own
 * a second UI state machine. The registry access can disappear once PR Detail
 * itself is dependency-injected with review state in a later cleanup.
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
    return this.publish(repositoryKey, pullRequestNumber, {
      type: "pendingReviewSessionChanged",
      session,
    });
  }

  async publishNavigationState(state: ReviewNavigationState): Promise<boolean> {
    if (!state.repositoryKey || state.pullRequestNumber === undefined) return false;
    return this.publish(state.repositoryKey, state.pullRequestNumber, {
      type: "reviewNavigationStateChanged",
      state,
    });
  }

  private async publish(
    repositoryKey: string,
    pullRequestNumber: number,
    message: unknown,
  ): Promise<boolean> {
    const sink = this.resolveSink(repositoryKey, pullRequestNumber);
    if (!sink) return false;
    return Promise.resolve(sink.postMessage(message));
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
