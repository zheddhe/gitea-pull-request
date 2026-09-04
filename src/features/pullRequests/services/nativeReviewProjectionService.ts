import * as vscode from "vscode";
import type {
  GiteaPullRequest,
  GiteaReviewComment,
} from "../../../api/types";
import type { RepoInfo, RepoManager } from "../../../context/repoManager";
import { debug, warn } from "../../../debug/outputChannel";
import {
  resolveReviewConversationPlacement,
  type ReviewConversationPlacement,
} from "../domain/reviewConversationPlacement";
import type { PullRequestWorkspaceState } from "../domain/pullRequestState";
import type { ReviewConversation } from "../domain/reviewConversationModel";
import type { PullRequestConversationService } from "./pullRequestConversationService";
import type { PullRequestSessionService } from "./pullRequestSessionService";
import {
  createPullRequestSnapshotDocumentIdentity,
  createPullRequestSnapshotUri,
} from "./pullRequestSnapshotDocumentProvider";

type ReviewProjectionSession = Pick<
  PullRequestSessionService,
  "current" | "onDidChangeState"
>;
type OpenTextDocument = (uri: vscode.Uri) => Thenable<vscode.TextDocument>;

export class NativeReviewProjectionService implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly threads = new Map<number, vscode.CommentThread>();
  private projectionEpoch = 0;

  constructor(
    private readonly conversations: PullRequestConversationService,
    private readonly repoManager: Pick<RepoManager, "getRepos">,
    private readonly session: ReviewProjectionSession,
    controller?: vscode.CommentController,
    private readonly openTextDocument: OpenTextDocument = (uri) =>
      vscode.workspace.openTextDocument(uri),
  ) {
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
    );
  }

  async initialize(): Promise<void> {
    await this.applySessionState(this.session.current);
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

    try {
      const snapshot = await this.conversations.load(
        repoInfo,
        state.pullRequest,
        true,
      );
      if (epoch !== this.projectionEpoch) return;

      for (const conversation of snapshot.conversations) {
        if (epoch !== this.projectionEpoch) return;
        await this.projectConversation(
          repoInfo,
          state.pullRequest,
          conversation,
          epoch,
        );
      }

      debug(
        `[native-review] projected repo=${repoInfo.key} pr=#${state.pullRequest.number} threads=${this.threads.size}`,
      );
    } catch (error) {
      if (epoch !== this.projectionEpoch) return;
      warn(
        `[native-review] projection failed repo=${repoInfo.key} pr=#${state.pullRequest.number}: ${(error as Error).message}`,
      );
    }
  }

  private async projectConversation(
    repoInfo: RepoInfo,
    pullRequest: GiteaPullRequest,
    conversation: ReviewConversation,
    epoch: number,
  ): Promise<void> {
    const placement = resolveReviewConversationPlacement(conversation);
    if (placement.kind !== "placed") return;

    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(
        repoInfo,
        pullRequest,
        placement.side,
        placement.path,
      ),
    );
    const document = await this.openTextDocument(uri);
    if (epoch !== this.projectionEpoch) return;

    const range = rangeForPlacement(document, placement);
    if (!range) {
      debug(
        `[native-review] unplaceable root=${conversation.root.id} path=${placement.path} line=${placement.line} side=${placement.side}`,
      );
      return;
    }

    const thread = this.controller.createCommentThread(
      uri,
      range,
      [conversation.root, ...conversation.replies].map(toNativeComment),
    );
    thread.contextValue = "giteaReviewConversation";
    thread.label = conversation.resolved ? "Resolved conversation" : "Review conversation";
    thread.state = conversation.resolved
      ? vscode.CommentThreadState.Resolved
      : vscode.CommentThreadState.Unresolved;
    thread.collapsibleState = conversation.resolved
      ? vscode.CommentThreadCollapsibleState.Collapsed
      : vscode.CommentThreadCollapsibleState.Expanded;
    this.threads.set(conversation.root.id, thread);
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

function safeUri(raw: string | undefined): vscode.Uri | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return vscode.Uri.parse(raw);
  } catch {
    return undefined;
  }
}
