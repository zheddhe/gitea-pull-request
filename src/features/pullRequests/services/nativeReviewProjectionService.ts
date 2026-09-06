import * as vscode from "vscode";
import type {
  GiteaPullRequest,
  GiteaReviewComment,
} from "../../../api/types";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";
import { debug, warn } from "../../../debug/outputChannel";
import type { GiteaServerCapabilities } from "../domain/giteaServerCapabilities";
import type {
  PendingConversationAction,
  PendingReviewReply,
  PendingReviewSession,
} from "../domain/pendingReviewSession";
import {
  resolveReviewConversationPlacement,
  type ReviewConversationPlacement,
} from "../domain/reviewConversationPlacement";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import type { ReviewConversation } from "../domain/reviewConversationModel";
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

type ReviewProjectionSession = Pick<
  PullRequestSessionService,
  "current" | "onDidChangeState"
>;
type ReviewPendingSessionSource = Pick<
  PullRequestReviewSessionService,
  | "get"
  | "queueReply"
  | "queueConversationAction"
  | "remove"
  | "onDidChange"
>;
type OpenTextDocument = (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
type CommandExecutor = <T>(command: string, ...args: unknown[]) => Thenable<T | undefined>;

interface NativeThreadBinding {
  repoInfo: RepoInfo;
  pullRequestNumber: number;
  rootCommentId: number;
  persistedResolved: boolean;
  persistedComments: vscode.Comment[];
  capabilities: GiteaServerCapabilities;
}

const NO_CAPABILITIES: GiteaServerCapabilities = {
  version: "",
  inlineReviewResolution: false,
  inlineReviewReplies: false,
};

export class NativeReviewProjectionService implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly threads = new Map<number, vscode.CommentThread>();
  private readonly threadBindings = new WeakMap<vscode.CommentThread, NativeThreadBinding>();
  private readonly internalConversationLoads = new Set<string>();
  private projectionEpoch = 0;
  private nextPendingId = 1;

  constructor(
    private readonly conversations: PullRequestConversationService,
    private readonly repoManager: Pick<RepoManager, "getRepos">,
    private readonly session: ReviewProjectionSession,
    private readonly pendingSessions: ReviewPendingSessionSource,
    controller?: vscode.CommentController,
    private readonly openTextDocument: OpenTextDocument = (uri) =>
      vscode.workspace.openTextDocument(uri),
    private readonly executeCommand: CommandExecutor = (command, ...args) =>
      vscode.commands.executeCommand(command, ...args),
  ) {
    const ownsController = !controller;
    this.controller =
      controller ??
      vscode.comments.createCommentController(
        "gitea.pullRequestReview",
        "Gitea Pull Request Review",
      );
    this.disposables.push(
      this.session.onDidChangeState((state) => {
        void this.applySessionState(state);
      }),
      this.pendingSessions.onDidChange((change) => {
        const state = this.session.current;
        if (
          state.kind !== "active" ||
          state.repository.key !== change.repositoryKey ||
          state.pullRequest.number !== change.pullRequestNumber
        ) {
          return;
        }
        this.applyPendingSession(change.session);
        if (change.reason === "reconcile") {
          void this.reloadPersistedConversations(
            change.repositoryKey,
            change.pullRequestNumber,
          );
        }
      }),
      this.conversations.onDidChange((snapshot) => {
        if (this.internalConversationLoads.has(snapshotIdentity(snapshot))) return;
        void this.applyConversationSnapshot(snapshot);
      }),
    );
    if (ownsController) {
      this.disposables.push(
        vscode.commands.registerCommand(
          "gitea.nativeReviewReply",
          (reply: vscode.CommentReply) => this.queueReply(reply),
        ),
        vscode.commands.registerCommand(
          "gitea.nativeReviewResolve",
          (thread: vscode.CommentThread) =>
            this.queueConversationState(thread, "resolve"),
        ),
        vscode.commands.registerCommand(
          "gitea.nativeReviewReopen",
          (thread: vscode.CommentThread) =>
            this.queueConversationState(thread, "reopen"),
        ),
      );
    }
  }

  async initialize(): Promise<void> {
    await this.applySessionState(this.session.current);
  }

  async queueReply(reply: vscode.CommentReply): Promise<void> {
    const binding = this.threadBindings.get(reply.thread);
    const body = reply.text.trim();
    if (!binding || !binding.capabilities.inlineReviewReplies || !body) return;

    const operation: PendingReviewReply = {
      id: this.pendingId("reply", binding.rootCommentId),
      rootCommentId: binding.rootCommentId,
      body,
    };
    const pending = this.pendingSessions.queueReply(
      binding.repoInfo,
      binding.pullRequestNumber,
      operation,
    );
    this.applyPendingState(reply.thread, binding, pending);
  }

  async queueConversationState(
    thread: vscode.CommentThread,
    action: "resolve" | "reopen",
  ): Promise<void> {
    const binding = this.threadBindings.get(thread);
    if (!binding || !binding.capabilities.inlineReviewResolution) return;

    const currentPending = this.pendingSessions.get(
      binding.repoInfo,
      binding.pullRequestNumber,
    );
    const existingAction = currentPending.conversationActions.find(
      (item) => item.rootCommentId === binding.rootCommentId,
    );
    const desiredResolved = action === "resolve";

    let pending = currentPending;
    if (desiredResolved === binding.persistedResolved) {
      if (existingAction) {
        pending = this.pendingSessions.remove(
          binding.repoInfo,
          binding.pullRequestNumber,
          existingAction.id,
        );
      }
    } else {
      const operation: PendingConversationAction = {
        id: `native-conversation-${binding.rootCommentId}`,
        rootCommentId: binding.rootCommentId,
        action,
      };
      pending = this.pendingSessions.queueConversationAction(
        binding.repoInfo,
        binding.pullRequestNumber,
        operation,
      );
    }

    this.applyPendingState(thread, binding, pending);
  }

  dispose(): void {
    this.projectionEpoch += 1;
    this.clearThreads();
    for (const disposable of this.disposables) disposable.dispose();
    this.controller.dispose();
  }

  private async applySessionState(state: PullRequestWorkspaceState): Promise<void> {
    const epoch = ++this.projectionEpoch;
    this.clearThreads();

    if (state.kind !== "active") return;

    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    if (!repoInfo) {
      warn(
        `[native-review] active repository unavailable key=${state.repository.key}`,
      );
      return;
    }

    const loadKey = snapshotIdentityFor(
      repoInfo.key,
      state.pullRequest.number,
      state.pullRequest.base.sha,
      state.pullRequest.head.sha,
    );

    try {
      this.internalConversationLoads.add(loadKey);
      let loaded:
        | [PullRequestConversationSnapshot, GiteaServerCapabilities]
        | undefined;
      try {
        loaded = await Promise.all([
          this.conversations.load(repoInfo, state.pullRequest, true),
          this.loadCapabilities(repoInfo),
        ]);
      } finally {
        this.internalConversationLoads.delete(loadKey);
      }
      if (!loaded || epoch !== this.projectionEpoch) return;

      const [snapshot, capabilities] = loaded;
      const pending = this.pendingSessions.get(
        repoInfo,
        state.pullRequest.number,
      );
      await this.projectSnapshot(
        repoInfo,
        state.pullRequest,
        snapshot,
        capabilities,
        pending,
        epoch,
      );
    } catch (error) {
      this.internalConversationLoads.delete(loadKey);
      if (epoch !== this.projectionEpoch) return;
      warn(
        `[native-review] projection failed repo=${repoInfo.key} pr=#${state.pullRequest.number}: ${(error as Error).message}`,
      );
    }
  }

  private async reloadPersistedConversations(
    repositoryKey: string,
    pullRequestNumber: number,
  ): Promise<void> {
    const state = this.session.current;
    if (
      state.kind !== "active" ||
      state.repository.key !== repositoryKey ||
      state.pullRequest.number !== pullRequestNumber
    ) {
      return;
    }
    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === repositoryKey);
    if (!repoInfo) return;

    try {
      await this.conversations.load(repoInfo, state.pullRequest, true);
    } catch (error) {
      warn(
        `[native-review] persisted reload after reconcile failed repo=${repoInfo.key} pr=#${pullRequestNumber}: ${(error as Error).message}`,
      );
    }
  }

  private async applyConversationSnapshot(
    snapshot: PullRequestConversationSnapshot,
  ): Promise<void> {
    const state = this.session.current;
    if (
      state.kind !== "active" ||
      state.repository.key !== snapshot.repositoryKey ||
      state.pullRequest.number !== snapshot.pullRequestNumber ||
      state.pullRequest.base.sha !== snapshot.baseSha ||
      state.pullRequest.head.sha !== snapshot.headSha
    ) {
      return;
    }

    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    if (!repoInfo) return;

    const epoch = ++this.projectionEpoch;
    this.clearThreads();
    try {
      const capabilities = await this.loadCapabilities(repoInfo);
      if (epoch !== this.projectionEpoch) return;
      const pending = this.pendingSessions.get(
        repoInfo,
        state.pullRequest.number,
      );
      await this.projectSnapshot(
        repoInfo,
        state.pullRequest,
        snapshot,
        capabilities,
        pending,
        epoch,
      );
      debug(
        `[native-review] rebound persisted conversations repo=${repoInfo.key} pr=#${state.pullRequest.number} head=${state.pullRequest.head.sha.slice(0, 8)}`,
      );
    } catch (error) {
      if (epoch !== this.projectionEpoch) return;
      warn(
        `[native-review] persisted rebind failed repo=${repoInfo.key} pr=#${state.pullRequest.number}: ${(error as Error).message}`,
      );
    }
  }

  private async projectSnapshot(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
    snapshot: PullRequestConversationSnapshot,
    capabilities: GiteaServerCapabilities,
    pending: PendingReviewSession,
    epoch: number,
  ): Promise<void> {
    let fallbackCount = 0;
    for (const conversation of snapshot.conversations) {
      if (epoch !== this.projectionEpoch) return;
      const placed = await this.projectConversation(
        repoInfo,
        pullRequest,
        conversation,
        capabilities,
        pending,
        epoch,
      );
      if (!placed) fallbackCount += 1;
    }

    if (epoch !== this.projectionEpoch) return;
    debug(
      `[native-review] projected repo=${repoInfo.key} pr=#${pullRequest.number} head=${pullRequest.head.sha.slice(0, 8)} threads=${this.threads.size} fallback=${fallbackCount}`,
    );
  }

  private async projectConversation(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
    conversation: ReviewConversation,
    capabilities: GiteaServerCapabilities,
    pending: PendingReviewSession,
    epoch: number,
  ): Promise<boolean> {
    const placement = resolveReviewConversationPlacement(conversation);
    if (placement.kind !== "placed") {
      debug(
        `[native-review] fallback root=${conversation.root.id} reason=${placement.reason}`,
      );
      return false;
    }

    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(
        repoInfo,
        pullRequest,
        placement.side,
        placement.path,
      ),
    );
    const document = await this.openTextDocument(uri);
    if (epoch !== this.projectionEpoch) return false;

    const range = rangeForPlacement(document, placement);
    if (!range) {
      debug(
        `[native-review] fallback root=${conversation.root.id} reason=lineMissing path=${placement.path} line=${placement.line} side=${placement.side}`,
      );
      return false;
    }

    const persistedComments = [conversation.root, ...conversation.replies].map(
      toNativeComment,
    );
    const thread = this.controller.createCommentThread(
      uri,
      range,
      persistedComments,
    );
    const binding: NativeThreadBinding = {
      repoInfo,
      pullRequestNumber: pullRequest.number,
      rootCommentId: conversation.root.id,
      persistedResolved: conversation.resolved,
      persistedComments,
      capabilities,
    };
    this.threadBindings.set(thread, binding);
    thread.canReply = capabilities.inlineReviewReplies;
    this.applyPendingState(thread, binding, pending);
    this.threads.set(conversation.root.id, thread);
    return true;
  }

  private applyPendingSession(pending: PendingReviewSession): void {
    for (const thread of this.threads.values()) {
      const binding = this.threadBindings.get(thread);
      if (binding) this.applyPendingState(thread, binding, pending);
    }
  }

  private applyPendingState(
    thread: vscode.CommentThread,
    binding: NativeThreadBinding,
    pending: PendingReviewSession,
  ): void {
    const pendingReplies = pending.replies.filter(
      (item) => item.rootCommentId === binding.rootCommentId,
    );
    thread.comments = [
      ...binding.persistedComments,
      ...pendingReplies.map(toNativePendingReply),
    ];

    const pendingAction = pending.conversationActions.find(
      (item) => item.rootCommentId === binding.rootCommentId,
    );
    const effectiveResolved = pendingAction
      ? pendingAction.action === "resolve"
      : binding.persistedResolved;
    this.applyThreadState(
      thread,
      effectiveResolved,
      binding.capabilities,
      pendingAction?.action,
    );
  }

  private applyThreadState(
    thread: vscode.CommentThread,
    resolved: boolean,
    capabilities: GiteaServerCapabilities,
    pendingAction?: "resolve" | "reopen",
  ): void {
    thread.contextValue = resolved
      ? capabilities.inlineReviewResolution
        ? "giteaReviewConversationResolvedActionable"
        : "giteaReviewConversationResolved"
      : capabilities.inlineReviewResolution
        ? "giteaReviewConversationUnresolvedActionable"
        : "giteaReviewConversationUnresolved";
    thread.label = pendingAction
      ? `${pendingAction === "resolve" ? "Resolve" : "Reopen"} pending`
      : resolved
        ? "Resolved conversation"
        : "Review conversation";
    thread.state = resolved
      ? vscode.CommentThreadState.Resolved
      : vscode.CommentThreadState.Unresolved;
    thread.collapsibleState = resolved
      ? vscode.CommentThreadCollapsibleState.Collapsed
      : vscode.CommentThreadCollapsibleState.Expanded;
  }

  private async loadCapabilities(
    repoInfo: RepoInfo,
  ): Promise<GiteaServerCapabilities> {
    return Promise.resolve(
      this.executeCommand<GiteaServerCapabilities>(
        "gitea.getReviewCapabilities",
        repoInfo,
      ),
    )
      .then((value) => value ?? NO_CAPABILITIES)
      .catch(() => NO_CAPABILITIES);
  }

  private pendingId(kind: string, rootCommentId: number): string {
    return `native-${kind}-${rootCommentId}-${this.nextPendingId++}`;
  }

  private clearThreads(): void {
    for (const thread of this.threads.values()) thread.dispose();
    this.threads.clear();
  }
}

function rangeForPlacement(
  document: vscode.TextDocument,
  placement: Extract<ReviewConversationPlacement, { kind: "placed" }>,
): vscode.Range | undefined {
  const lineIndex = placement.line - 1;
  if (lineIndex < 0 || lineIndex >= document.lineCount) return undefined;
  return document.lineAt(lineIndex).range;
}

function toNativeComment(comment: GiteaReviewComment): vscode.Comment {
  const body = new vscode.MarkdownString(comment.body);
  body.isTrusted = false;
  body.supportHtml = false;

  const iconPath = safeUri(comment.user.avatar_url);
  return {
    body,
    mode: vscode.CommentMode.Preview,
    author: {
      name: comment.user.login,
      ...(iconPath ? { iconPath } : {}),
    },
    timestamp: new Date(comment.created_at),
    contextValue: "giteaReviewComment",
  };
}

function toNativePendingReply(reply: PendingReviewReply): vscode.Comment {
  const body = new vscode.MarkdownString(reply.body);
  body.isTrusted = false;
  body.supportHtml = false;
  return {
    body,
    mode: vscode.CommentMode.Preview,
    author: { name: "Pending reply · not submitted" },
    contextValue: "giteaPendingReviewReply",
  };
}

function snapshotIdentity(snapshot: PullRequestConversationSnapshot): string {
  return snapshotIdentityFor(
    snapshot.repositoryKey,
    snapshot.pullRequestNumber,
    snapshot.baseSha,
    snapshot.headSha,
  );
}

function snapshotIdentityFor(
  repositoryKey: string,
  pullRequestNumber: number,
  baseSha: string,
  headSha: string,
): string {
  return [repositoryKey, pullRequestNumber, baseSha, headSha].join("::");
}

function safeUri(raw: string | undefined): vscode.Uri | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return vscode.Uri.parse(raw);
  } catch {
    return undefined;
  }
}
