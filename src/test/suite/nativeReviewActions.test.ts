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

function comment(
  id: number,
  options: Partial<GiteaReviewComment> = {},
): GiteaReviewComment {
  return {
    id,
    user,
    body: `comment ${id}`,
    path: "src/example.ts",
    position: 3,
    original_position: 3,
    created_at: "2026-09-04T20:00:00Z",
    updated_at: "2026-09-04T20:00:00Z",
    ...options,
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

function capabilityGateway(capabilities: {
  version: string;
  inlineReviewResolution: boolean;
  inlineReviewReplies: boolean;
}) {
  return async <T>(command: string): Promise<T | undefined> => {
    if (command === "gitea.getReviewCapabilities") return capabilities as T;
    return undefined;
  };
}

const fullCapabilities = {
  version: "1.27.0",
  inlineReviewResolution: true,
  inlineReviewReplies: true,
};

suite("Native review actions", () => {
  test("shows pending reply and cancels resolve when returning to persisted open state", async () => {
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
      pending,
      fakeController(captured),
      async () => fakeDocument(),
      capabilityGateway(fullCapabilities),
    );

    await projection.initialize();
    const thread = captured[0];
    assert.strictEqual(thread.canReply, true);

    await projection.queueReply({ thread, text: "pending reply" });
    const afterReply: PendingReviewSession = pending.get(repoInfo, 42);
    assert.strictEqual(afterReply.replies.length, 1);
    assert.strictEqual(afterReply.replies[0].rootCommentId, 10);
    assert.strictEqual(afterReply.replies[0].body, "pending reply");
    assert.strictEqual(thread.comments.length, 2);
    assert.strictEqual(thread.comments[1].author.name, "Pending reply · not submitted");
    assert.strictEqual(thread.comments[1].contextValue, "giteaPendingReviewReply");

    await projection.queueConversationState(thread, "resolve");
    assert.strictEqual(
      pending.get(repoInfo, 42).conversationActions[0].action,
      "resolve",
    );
    assert.strictEqual(thread.state, vscode.CommentThreadState.Resolved);
    assert.strictEqual(thread.label, "Resolve pending");

    await projection.queueConversationState(thread, "reopen");
    assert.strictEqual(pending.get(repoInfo, 42).conversationActions.length, 0);
    assert.strictEqual(thread.state, vscode.CommentThreadState.Unresolved);
    assert.strictEqual(thread.label, "Review conversation");

    projection.dispose();
    conversations.dispose();
    session.dispose();
    pending.dispose();
  });

  test("shows reopen pending and cancels it when returning to persisted resolved state", async () => {
    const pending = new PullRequestReviewSessionService();
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(10, { resolver: user })],
    });
    const session = await activeSession();
    const captured: vscode.CommentThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(),
      capabilityGateway(fullCapabilities),
    );

    await projection.initialize();
    const thread = captured[0];
    assert.strictEqual(thread.state, vscode.CommentThreadState.Resolved);

    await projection.queueConversationState(thread, "reopen");
    assert.strictEqual(
      pending.get(repoInfo, 42).conversationActions[0].action,
      "reopen",
    );
    assert.strictEqual(thread.state, vscode.CommentThreadState.Unresolved);
    assert.strictEqual(thread.label, "Reopen pending");

    await projection.queueConversationState(thread, "resolve");
    assert.strictEqual(pending.get(repoInfo, 42).conversationActions.length, 0);
    assert.strictEqual(thread.state, vscode.CommentThreadState.Resolved);
    assert.strictEqual(thread.label, "Resolved conversation");

    projection.dispose();
    conversations.dispose();
    session.dispose();
    pending.dispose();
  });

  test("reflects pending operations queued from another surface without refresh", async () => {
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
      pending,
      fakeController(captured),
      async () => fakeDocument(),
      capabilityGateway(fullCapabilities),
    );

    await projection.initialize();
    const thread = captured[0];

    pending.queueReply(repoInfo, 42, {
      id: "detail-reply-1",
      rootCommentId: 10,
      body: "reply from PR Detail",
    });
    assert.strictEqual(thread.comments.length, 2);
    assert.strictEqual(thread.comments[1].author.name, "Pending reply · not submitted");

    pending.queueConversationAction(repoInfo, 42, {
      id: "detail-action-1",
      rootCommentId: 10,
      action: "resolve",
    });
    assert.strictEqual(thread.state, vscode.CommentThreadState.Resolved);
    assert.strictEqual(thread.label, "Resolve pending");

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
      pending,
      fakeController(captured),
      async () => fakeDocument(),
      capabilityGateway({
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
