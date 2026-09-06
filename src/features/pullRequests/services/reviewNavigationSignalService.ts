import * as vscode from "vscode";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";
import { debug } from "../../../debug/outputChannel";
import {
  buildReviewNavigationModel,
  nextReviewNavigationIndex,
} from "../domain/reviewNavigationModel";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import type {
  PullRequestConversationService,
  PullRequestConversationSnapshot,
} from "./pullRequestConversationService";
import type { PullRequestReviewSessionService } from "./pullRequestReviewSessionService";
import type { PullRequestSessionService } from "./pullRequestSessionService";
import {
  createPullRequestSnapshotDocumentIdentity,
  createPullRequestSnapshotUri,
} from "./pullRequestSnapshotDocumentProvider";

interface NavigationTarget {
  repoInfo: RepoInfo;
  pullRequest: Extract<PullRequestWorkspaceState, { kind: "active" }>[
    "pullRequest"
  ];
  rootCommentId: number;
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

  private snapshot: PullRequestConversationSnapshot | undefined;
  private unresolvedByPath = new Map<string, number>();
  private targets: NavigationTarget[] = [];
  private currentRootCommentId: number | undefined;
  private rebuildEpoch = 0;

  constructor(
    private readonly conversations: PullRequestConversationService,
    private readonly pending: ReviewPendingSource,
    private readonly session: ReviewNavigationSession,
    private readonly repoManager: Pick<RepoManager, "getRepos">,
    private readonly openTextDocument: OpenTextDocument = (uri) =>
      vscode.workspace.openTextDocument(uri),
    private readonly executeCommand: CommandExecutor = (command, ...args) =>
      vscode.commands.executeCommand(command, ...args),
  ) {
    this.disposables.push(
      this.decorationEmitter,
      vscode.window.registerFileDecorationProvider(this),
      vscode.commands.registerCommand(
        "gitea.previousUnresolvedReviewConversation",
        () => this.navigate(-1),
      ),
      vscode.commands.registerCommand(
        "gitea.nextUnresolvedReviewConversation",
        () => this.navigate(1),
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
    this.targets = [];
    this.currentRootCommentId = undefined;
    this.unresolvedByPath.clear();
    this.snapshot = undefined;
    void this.setNavigationAvailable(false);
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async applySessionState(
    state: PullRequestWorkspaceState,
  ): Promise<void> {
    this.snapshot = undefined;
    this.targets = [];
    this.currentRootCommentId = undefined;
    this.unresolvedByPath.clear();
    this.decorationEmitter.fire(undefined);
    await this.setNavigationAvailable(false);

    if (state.kind !== "active") return;
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

    const targets: NavigationTarget[] = [];
    for (const candidate of model.placedUnresolved) {
      const uri = createPullRequestSnapshotUri(
        createPullRequestSnapshotDocumentIdentity(
          repoInfo,
          state.pullRequest,
          candidate.side,
          candidate.path,
        ),
      );
      try {
        const document = await this.openTextDocument(uri);
        if (epoch !== this.rebuildEpoch) return;
        if (candidate.line <= 0 || candidate.line > document.lineCount) {
          continue;
        }
        targets.push({
          repoInfo,
          pullRequest: state.pullRequest,
          ...candidate,
          uri,
        });
      } catch {
        if (epoch !== this.rebuildEpoch) return;
      }
    }

    if (epoch !== this.rebuildEpoch) return;
    this.targets = targets;
    if (
      this.currentRootCommentId !== undefined &&
      !targets.some(
        (target) => target.rootCommentId === this.currentRootCommentId,
      )
    ) {
      this.currentRootCommentId = undefined;
    }
    await this.setNavigationAvailable(targets.length > 0);
    debug(
      `[review-navigation] repo=${repoInfo.key} pr=#${state.pullRequest.number} unresolvedFiles=${this.unresolvedByPath.size} placed=${targets.length}`,
    );
  }

  private async setNavigationAvailable(available: boolean): Promise<void> {
    await Promise.resolve(
      this.executeCommand(
        "setContext",
        "gitea.reviewNavigationAvailable",
        available,
      ),
    );
  }

  private async navigate(direction: -1 | 1): Promise<void> {
    if (this.targets.length === 0) return;

    const cursorIndex =
      this.currentRootCommentId === undefined
        ? -1
        : this.targets.findIndex(
            (target) => target.rootCommentId === this.currentRootCommentId,
          );
    const current =
      cursorIndex >= 0
        ? cursorIndex
        : currentTargetIndex(this.targets, vscode.window.activeTextEditor);
    const nextIndex = nextReviewNavigationIndex(
      current,
      this.targets.length,
      direction,
    );
    if (nextIndex < 0) return;
    const target = this.targets[nextIndex];

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
      this.currentRootCommentId = target.rootCommentId;
      return;
    }

    await vscode.window.showTextDocument(target.uri, {
      preview: true,
      selection: range,
    });
    this.currentRootCommentId = target.rootCommentId;
  }
}

function currentTargetIndex(
  targets: NavigationTarget[],
  editor: vscode.TextEditor | undefined,
): number {
  if (!editor) return -1;
  const uri = editor.document.uri.toString();
  const line = editor.selection.active.line + 1;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (target.uri.toString() !== uri) continue;
    const distance = Math.abs(target.line - line);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function normalizeResourcePath(uri: vscode.Uri): string {
  return decodeURIComponent(uri.path).replace(/^\/+/, "");
}
