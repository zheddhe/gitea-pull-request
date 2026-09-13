import * as vscode from "vscode";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";
import { debug } from "../../../debug/outputChannel";
import {
  buildReviewNavigationModel,
  type PlacedReviewNavigationCandidate,
  type ReviewNavigationMode,
} from "../domain/reviewNavigationModel";
import { nextReviewNavigationItem } from "../domain/reviewNavigationSelection";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import { PRDetailReviewSyncBridge } from "./prDetailReviewSyncBridge";
import type {
  PullRequestConversationService,
  PullRequestConversationSnapshot,
} from "./pullRequestConversationService";
import type { PullRequestReviewSessionService } from "./pullRequestReviewSessionService";
import type { PullRequestSessionService } from "./pullRequestSessionService";
import { ReviewNavigationStateService } from "./reviewNavigationStateService";
import {
  createPullRequestSnapshotDocumentIdentity,
  createPullRequestSnapshotUri,
} from "./pullRequestSnapshotDocumentProvider";

interface NavigationTarget {
  id: string;
  repoInfo: RepoInfo;
  pullRequest: Extract<PullRequestWorkspaceState, { kind: "active" }>[
    "pullRequest"
  ];
  path: string;
  side: "base" | "head";
  line: number;
  uri: vscode.Uri;
}

type ReviewNavigationSession = Pick<
  PullRequestSessionService,
  "current" | "onDidChangeState"
>;
type ReviewPendingSource = Pick<
  PullRequestReviewSessionService,
  "get" | "onDidChange"
>;
type OpenTextDocument = (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
type CommandExecutor = <T>(
  command: string,
  ...args: unknown[]
) => Thenable<T | undefined>;

export class ReviewNavigationSignalService
  implements vscode.Disposable, vscode.FileDecorationProvider
{
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationEmitter =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.decorationEmitter.event;

  private readonly prDetailSync = new PRDetailReviewSyncBridge();
  private snapshot: PullRequestConversationSnapshot | undefined;
  private unresolvedByPath = new Map<string, number>();
  private unresolvedTargets: NavigationTarget[] = [];
  private pendingTargets: NavigationTarget[] = [];
  private rebuildEpoch = 0;

  constructor(
    private readonly conversations: PullRequestConversationService,
    private readonly pending: ReviewPendingSource,
    private readonly session: ReviewNavigationSession,
    private readonly repoManager: Pick<RepoManager, "getRepos">,
    private readonly navigationState = new ReviewNavigationStateService(),
    private readonly openTextDocument: OpenTextDocument = (uri) =>
      vscode.workspace.openTextDocument(uri),
    private readonly executeCommand: CommandExecutor = (command, ...args) =>
      vscode.commands.executeCommand(command, ...args),
  ) {
    this.disposables.push(
      this.decorationEmitter,
      this.navigationState,
      vscode.window.registerFileDecorationProvider(this),
      vscode.commands.registerCommand(
        "gitea.previousUnresolvedReviewConversation",
        () => this.navigate("unresolved", -1),
      ),
      vscode.commands.registerCommand(
        "gitea.nextUnresolvedReviewConversation",
        () => this.navigate("unresolved", 1),
      ),
      vscode.commands.registerCommand(
        "gitea.previousPendingReviewOperation",
        () => this.navigate("pending", -1),
      ),
      vscode.commands.registerCommand(
        "gitea.nextPendingReviewOperation",
        () => this.navigate("pending", 1),
      ),
      this.session.onDidChangeState((state) => {
        void this.applySessionState(state);
      }),
      this.conversations.onDidChange((snapshot) => {
        if (!this.matchesActiveSnapshot(snapshot)) return;
        this.snapshot = snapshot;
        void this.rebuild();
      }),
      this.pending.onDidChange((change) => {
        void this.prDetailSync.publishPendingSession(
          change.repositoryKey,
          change.pullRequestNumber,
          change.session,
        );

        const state = this.session.current;
        if (
          state.kind !== "active" ||
          state.repository.key !== change.repositoryKey ||
          state.pullRequest.number !== change.pullRequestNumber
        ) {
          return;
        }
        void this.rebuild();
      }),
    );
  }

  async initialize(): Promise<void> {
    await this.applySessionState(this.session.current);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const path = normalizeResourcePath(uri);
    const count = this.unresolvedByPath.get(path) ?? 0;
    if (count <= 0) return undefined;
    return {
      badge: count > 9 ? "9+" : String(count),
      tooltip: `${count} unresolved review conversation${count === 1 ? "" : "s"}`,
      propagate: false,
    };
  }

  dispose(): void {
    this.rebuildEpoch += 1;
    this.unresolvedTargets = [];
    this.pendingTargets = [];
    this.unresolvedByPath.clear();
    this.snapshot = undefined;
    this.navigationState.clear();
    void this.setNavigationAvailable("unresolved", false);
    void this.setNavigationAvailable("pending", false);
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async applySessionState(
    state: PullRequestWorkspaceState,
  ): Promise<void> {
    this.snapshot = undefined;
    this.unresolvedTargets = [];
    this.pendingTargets = [];
    this.unresolvedByPath.clear();
    this.decorationEmitter.fire(undefined);
    await Promise.all([
      this.setNavigationAvailable("unresolved", false),
      this.setNavigationAvailable("pending", false),
    ]);

    if (state.kind !== "active") {
      this.navigationState.clear();
      return;
    }
    this.navigationState.activate(
      state.repository.key,
      state.pullRequest.number,
    );
    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    if (!repoInfo) return;

    this.snapshot = this.conversations.get(repoInfo, state.pullRequest);
    if (this.snapshot) await this.rebuild();
  }

  private matchesActiveSnapshot(
    snapshot: PullRequestConversationSnapshot,
  ): boolean {
    const state = this.session.current;
    return (
      state.kind === "active" &&
      state.repository.key === snapshot.repositoryKey &&
      state.pullRequest.number === snapshot.pullRequestNumber &&
      state.pullRequest.base.sha === snapshot.baseSha &&
      state.pullRequest.head.sha === snapshot.headSha
    );
  }

  private async rebuild(): Promise<void> {
    const state = this.session.current;
    const snapshot = this.snapshot;
    if (
      state.kind !== "active" ||
      !snapshot ||
      !this.matchesActiveSnapshot(snapshot)
    ) {
      return;
    }
    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    if (!repoInfo) return;

    const epoch = ++this.rebuildEpoch;
    const model = buildReviewNavigationModel(
      snapshot.conversations,
      this.pending.get(repoInfo, state.pullRequest.number),
    );
    this.unresolvedByPath = new Map(model.unresolvedByPath);
    this.decorationEmitter.fire(undefined);

    const logicalItems =
      this.navigationState.current.mode === "pending"
        ? model.pending
        : model.unresolved;
    this.navigationState.reconcile(logicalItems.map((item) => item.id));

    const [unresolvedTargets, pendingTargets] = await Promise.all([
      this.buildTargets(
        repoInfo,
        state.pullRequest,
        model.placedUnresolved,
        epoch,
      ),
      this.buildTargets(
        repoInfo,
        state.pullRequest,
        model.placedPending,
        epoch,
      ),
    ]);
    if (epoch !== this.rebuildEpoch) return;

    this.unresolvedTargets = unresolvedTargets;
    this.pendingTargets = pendingTargets;
    await Promise.all([
      this.setNavigationAvailable("unresolved", unresolvedTargets.length > 0),
      this.setNavigationAvailable("pending", pendingTargets.length > 0),
    ]);
    debug(
      `[review-navigation] repo=${repoInfo.key} pr=#${state.pullRequest.number} unresolvedFiles=${this.unresolvedByPath.size} unresolvedLogical=${model.unresolved.length} unresolvedPlaced=${unresolvedTargets.length} pendingLogical=${model.pending.length} pendingPlaced=${pendingTargets.length}`,
    );
  }

  private async buildTargets(
    repoInfo: RepoInfo,
    pullRequest: Extract<PullRequestWorkspaceState, { kind: "active" }>[
      "pullRequest"
    ],
    candidates: readonly PlacedReviewNavigationCandidate[],
    epoch: number,
  ): Promise<NavigationTarget[]> {
    const targets: NavigationTarget[] = [];
    for (const candidate of candidates) {
      const uri = createPullRequestSnapshotUri(
        createPullRequestSnapshotDocumentIdentity(
          repoInfo,
          pullRequest,
          candidate.side,
          candidate.path,
        ),
      );
      try {
        const document = await this.openTextDocument(uri);
        if (epoch !== this.rebuildEpoch) return [];
        if (candidate.line <= 0 || candidate.line > document.lineCount) continue;
        targets.push({
          id: candidate.id,
          repoInfo,
          pullRequest,
          path: candidate.path,
          side: candidate.side,
          line: candidate.line,
          uri,
        });
      } catch {
        if (epoch !== this.rebuildEpoch) return [];
      }
    }
    return targets;
  }

  private async setNavigationAvailable(
    mode: ReviewNavigationMode,
    available: boolean,
  ): Promise<void> {
    const contextKey =
      mode === "pending"
        ? "gitea.pendingReviewNavigationAvailable"
        : "gitea.reviewNavigationAvailable";
    await Promise.resolve(this.executeCommand("setContext", contextKey, available));
  }

  private async navigate(
    mode: ReviewNavigationMode,
    direction: -1 | 1,
  ): Promise<void> {
    const targets = mode === "pending" ? this.pendingTargets : this.unresolvedTargets;
    if (targets.length === 0) return;

    this.navigationState.setMode(mode);
    const activeItemId = this.navigationState.current.activeItemId;
    const logicalTarget = nextReviewNavigationItem(
      targets.map((target) => ({
        id: target.id,
        kind: "conversation" as const,
        placeable: true as const,
        path: target.path,
        side: target.side,
        line: target.line,
      })),
      activeItemId,
      direction,
    );
    if (!logicalTarget) return;
    const target = targets.find((item) => item.id === logicalTarget.id);
    if (!target) return;

    await this.executeCommand(
      "gitea.openFileDiff",
      target.repoInfo,
      target.pullRequest,
      target.path,
    );

    const line = Math.max(0, target.line - 1);
    const range = new vscode.Range(line, 0, line, 0);
    const editor = vscode.window.visibleTextEditors.find(
      (item) => item.document.uri.toString() === target.uri.toString(),
    );
    if (editor) {
      editor.selection = new vscode.Selection(line, 0, line, 0);
      editor.revealRange(
        range,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
      this.navigationState.select(target.id);
      return;
    }

    await vscode.window.showTextDocument(target.uri, {
      preview: true,
      selection: range,
    });
    this.navigationState.select(target.id);
  }
}

function normalizeResourcePath(uri: vscode.Uri): string {
  return decodeURIComponent(uri.path).replace(/^\/+/, "");
}
