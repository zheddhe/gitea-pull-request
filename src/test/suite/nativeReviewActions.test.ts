import * as assert from "assert";
import * as vscode from "vscode";
import type {
  GiteaPullRequest,
  GiteaReviewComment,
  GiteaUser,
} from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import type { PendingReviewSession } from "../../features/pullRequests/domain/pendingReviewSession";
import { NativeReviewProjectionService } from "../../features/pullRequests/services/nativeReviewProjectionService";
import { PullRequestConversationService } from "../../features/pullRequests/services/pullRequestConversationService";
import { PullRequestReviewSessionService } from "../../features/pullRequests/services/pullRequestReviewSessionService";
import { PullRequestSessionService } from "../../features/pullRequests/services/pullRequestSessionService";

const user: GiteaUser = {
  id: 1,
  login: "reviewer",
  full_name: "Reviewer",
  email: "reviewer@example.test",
  avatar_url: "",
};

const repoInfo: RepoInfo = {
  serverUrl: "https://gitea.example",
  owner: "alice",
  repo: "repo",
  rootPath: "/workspace/repo",
  label: "alice/repo",
  key: "https://gitea.example|alice/repo",
};

const pullRequest = {
  number: 42,
  title: "Native review actions",
  base: {
    ref: "main",
    sha: "base-sha",
    repo: { full_name: "alice/repo" },
  },
  head: {
    ref: "feature/review",
    sha: "head-sha",
    repo: { full_name: "alice/repo" },
  },
} as unknown as GiteaPullRequest;

function comment(id: number): GiteaReviewComment {
  return {
    id,
    user,
    body: `comment ${id}`,
    path: "src/example.ts",
    position: 3,
    original_position: 3,
    created_at: "2026-09-04T20:00:00Z",
    updated_at: "2026-09-04T20:00:00Z",
  };
}

function fakeDocument(): vscode.TextDocument {
  return {
    lineCount: 20,
    lineAt: (line: number) => ({ range: new vscode.Range(line, 0, line, 12) }),
  } as unknown as vscode.TextDocument;
}

function fakeController(captured: vscode.CommentThread[]): vscode.CommentController {
  return {
    id: "test.nativeReviewActions",
    label: "Native review actions",
    createCommentThread: (
      uri: vscode.Uri,
      range: vscode.Range,
      comments: readonly vscode.Comment[],
    ) => {
      const thread = {
        uri,
        range,
        comments: [...comments],
        canReply: false,
        collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
        dispose: () => undefined,
      } as unknown as vscode.CommentThread;
      captured.push(thread);
      return thread;
    },
    dispose: () => undefined,
  } as unknown as vscode.CommentController;
}

async function activeSession(): Promise<PullRequestSessionService> {
  const session = new PullRequestSessionService(async () => undefined);
  await session.initialize();
  await session.activate(
    {
      key: repoInfo.key,
      fullName: "alice/repo",
      owner: "alice",
      name: "repo",
    },
    pullRequest,
  );
  return session;
}

function commandGateway(
  pending: PullRequestReviewSessionService,
  capabilities: {
    version: string;
    inlineReviewResolution: boolean;
    inlineReviewReplies: boolean;
  },
) {
  return async <T>(command: string, ...args: unknown[]): Promise<T | undefined> => {
    switch (command) {
      case "gitea.getReviewCapabilities":
        return capabilities as T;
      case "gitea.getPendingReviewSession":
        return pending.get(repoInfo, pullRequest.number) as T;
      case "gitea.queuePendingReviewReply":
        return pending.queueReply(
          repoInfo,
          pullRequest.number,
          args[2] as Parameters<PullRequestReviewSessionService["queueReply"]>[2],
        ) as T;
      case "gitea.queuePendingConversationAction":
        return pending.queueConversationAction(
          repoInfo,
          pullRequest.number,
          args[2] as Parameters<
            PullRequestReviewSessionService["queueConversationAction"]
          >[2],
        ) as T;
      default:
        return undefined;
    }
  };
}

suite("Native review actions", () => {
  test("queues reply and lifecycle actions through the shared pending session", async () => {
    const pending = new PullRequestReviewSessionService();
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(10)],
    });
    const session = await activeSession();
    const captured: vscode.CommentThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      fakeController(captured),
      async () => fakeDocument(),
      commandGateway(pending, {
        version: "1.27.0",
        inlineReviewResolution: true,
        inlineReviewReplies: true,
      }),
    );

    await projection.initialize();
    const thread = captured[0];
    assert.strictEqual(thread.canReply, true);

    await projection.queueReply({ thread, text: "pending reply" });
    const afterReply: PendingReviewSession = pending.get(repoInfo, 42);
    assert.strictEqual(afterReply.replies.length, 1);
    assert.strictEqual(afterReply.replies[0].rootCommentId, 10);
    assert.strictEqual(afterReply.replies[0].body, "pending reply");

    await projection.queueConversationState(thread, "resolve");
    assert.strictEqual(
      pending.get(repoInfo, 42).conversationActions[0].action,
      "resolve",
    );
    assert.strictEqual(thread.state, vscode.CommentThreadState.Resolved);

    await projection.queueConversationState(thread, "reopen");
    assert.strictEqual(
      pending.get(repoInfo, 42).conversationActions[0].action,
      "reopen",
    );
    assert.strictEqual(thread.state, vscode.CommentThreadState.Unresolved);

    projection.dispose();
    conversations.dispose();
    session.dispose();
    pending.dispose();
  });

  test("capability-gates native reply and lifecycle actions", async () => {
    const pending = new PullRequestReviewSessionService();
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(10)],
    });
    const session = await activeSession();
    const captured: vscode.CommentThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      fakeController(captured),
      async () => fakeDocument(),
      commandGateway(pending, {
        version: "1.25.0",
        inlineReviewResolution: false,
        inlineReviewReplies: false,
      }),
    );

    await projection.initialize();
    const thread = captured[0];
    assert.strictEqual(thread.canReply, false);

    await projection.queueReply({ thread, text: "ignored" });
    await projection.queueConversationState(thread, "resolve");
    assert.deepStrictEqual(pending.get(repoInfo, 42), {
      inlineComments: [],
      replies: [],
      conversationActions: [],
    });

    projection.dispose();
    conversations.dispose();
    session.dispose();
    pending.dispose();
  });
});
