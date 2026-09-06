import * as assert from "assert";
import * as vscode from "vscode";
import type {
  GiteaPullRequest,
  GiteaReviewComment,
  GiteaUser,
} from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
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

const repositoryRef = {
  key: repoInfo.key,
  fullName: "alice/repo",
  owner: "alice",
  name: "repo",
};

const pullRequest = {
  number: 42,
  title: "Native review",
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

function pullRequestAtHead(headSha: string): GiteaPullRequest {
  return {
    ...pullRequest,
    base: { ...pullRequest.base },
    head: { ...pullRequest.head, sha: headSha },
  } as GiteaPullRequest;
}

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
    created_at: `2026-09-04T20:00:${String(id).padStart(2, "0")}Z`,
    updated_at: `2026-09-04T20:00:${String(id).padStart(2, "0")}Z`,
    ...options,
  };
}

interface CapturedThread {
  uri: vscode.Uri;
  range: vscode.Range;
  comments: vscode.Comment[];
  thread: vscode.CommentThread;
}

function fakeController(captured: CapturedThread[]): vscode.CommentController {
  return {
    id: "test.giteaReview",
    label: "Test Gitea Review",
    createCommentThread: (
      uri: vscode.Uri,
      range: vscode.Range,
      comments: readonly vscode.Comment[],
    ) => {
      let disposed = false;
      const thread = {
        uri,
        range,
        comments: [...comments],
        collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
        canReply: false,
        dispose: () => {
          disposed = true;
        },
        get disposed() {
          return disposed;
        },
      } as unknown as vscode.CommentThread;
      captured.push({ uri, range, comments: [...comments], thread });
      return thread;
    },
    dispose: () => undefined,
  } as unknown as vscode.CommentController;
}

function fakeDocument(lineCount: number): vscode.TextDocument {
  return {
    lineCount,
    lineAt: (line: number) => ({
      range: new vscode.Range(line, 0, line, 12),
    }),
  } as unknown as vscode.TextDocument;
}

async function activeSession(): Promise<PullRequestSessionService> {
  const session = new PullRequestSessionService(async () => undefined);
  await session.initialize();
  await session.activate(repositoryRef, pullRequest);
  return session;
}

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      assert.fail(`Timed out waiting for ${description}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

suite("Native review projection service", () => {
  test("projects persisted conversation roots and replies on the immutable head URI", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [
        comment(1),
        comment(2, { in_reply_to_id: 1 }),
      ],
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(20),
    );

    await projection.initialize();

    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].uri.scheme, "gitea-pr");
    assert.match(captured[0].uri.path, /^\/head\/src\/example\.ts$/);
    assert.strictEqual(captured[0].range.start.line, 2);
    assert.deepStrictEqual(
      captured[0].comments.map((item) => item.author.name),
      ["reviewer", "reviewer"],
    );
    assert.strictEqual(
      captured[0].thread.state,
      vscode.CommentThreadState.Unresolved,
    );

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("projects old-only conversations on the immutable base URI", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [
        comment(1, { position: 0, original_position: 6 }),
      ],
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(20),
    );

    await projection.initialize();

    assert.strictEqual(captured.length, 1);
    assert.match(captured[0].uri.path, /^\/base\/src\/example\.ts$/);
    assert.strictEqual(captured[0].range.start.line, 5);

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("does not create a native thread when the reported line is outside the snapshot", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(1, { position: 50 })],
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(10),
    );

    await projection.initialize();

    assert.strictEqual(captured.length, 0);

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("projects resolved conversations as collapsed resolved native threads", async () => {
    const resolver = { ...user, id: 2, login: "resolver" };
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [
        comment(1),
        comment(2, { resolver }),
      ],
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(20),
    );

    await projection.initialize();

    assert.strictEqual(captured[0].thread.state, vscode.CommentThreadState.Resolved);
    assert.strictEqual(
      captured[0].thread.collapsibleState,
      vscode.CommentThreadCollapsibleState.Collapsed,
    );

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("reloads persisted conversations after pending submission reconciliation", async () => {
    let persisted = [comment(1)];
    let loads = 0;
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => {
        loads += 1;
        return persisted;
      },
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(20),
    );

    await projection.initialize();
    pending.queueReply(repoInfo, 42, {
      id: "reply-1",
      rootCommentId: 1,
      body: "pending reply",
    });
    assert.strictEqual(captured[0].thread.comments.length, 2);

    persisted = [comment(1), comment(2, { in_reply_to_id: 1 })];
    pending.reconcile(repoInfo, 42, {
      succeededInlineCommentIds: [],
      succeededReplyIds: ["reply-1"],
      succeededConversationActionIds: [],
      errors: [],
    });
    await waitFor(
      () => captured.length === 2,
      "persisted conversation reprojection after reconciliation",
    );

    assert.ok(loads >= 2);
    assert.strictEqual(
      (captured[0].thread as unknown as { disposed: boolean }).disposed,
      true,
    );
    assert.strictEqual(captured[1].thread.comments.length, 2);
    assert.deepStrictEqual(
      captured[1].thread.comments.map((item) => item.author.name),
      ["reviewer", "reviewer"],
    );
    assert.strictEqual(pending.get(repoInfo, 42).replies.length, 0);

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("rebinds to a new immutable head while preserving pending review work", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(1)],
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    pending.queueReply(repoInfo, 42, {
      id: "reply-1",
      rootCommentId: 1,
      body: "keep me",
    });
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(20),
    );

    await projection.initialize();
    assert.match(captured[0].uri.query, /sha=head-sha/);

    await session.activate(repositoryRef, pullRequestAtHead("head-sha-2"));
    await waitFor(
      () => captured.length === 2,
      "native thread rebind to the refreshed head",
    );

    assert.strictEqual(
      (captured[0].thread as unknown as { disposed: boolean }).disposed,
      true,
    );
    assert.match(captured[1].uri.query, /sha=head-sha-2/);
    assert.strictEqual(captured[1].thread.comments.length, 2);
    assert.strictEqual(pending.get(repoInfo, 42).replies[0].body, "keep me");

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("drops a thread instead of guessing a placement after head refresh", async () => {
    let refreshed = false;
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () =>
        refreshed ? [comment(1, { position: 50 })] : [comment(1)],
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    pending.queueReply(repoInfo, 42, {
      id: "reply-1",
      rootCommentId: 1,
      body: "preserved fallback work",
    });
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async () => fakeDocument(10),
    );

    await projection.initialize();
    assert.strictEqual(captured.length, 1);

    refreshed = true;
    await session.activate(repositoryRef, pullRequestAtHead("head-sha-2"));
    await waitFor(
      () => (captured[0].thread as unknown as { disposed: boolean }).disposed,
      "unplaceable thread disposal after head refresh",
    );

    assert.strictEqual(captured.length, 1);
    assert.strictEqual(pending.get(repoInfo, 42).replies.length, 1);

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });
});
