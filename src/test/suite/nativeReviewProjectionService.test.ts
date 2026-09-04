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

suite("Native review projection service", () => {
  test("projects persisted conversation roots and replies on the immutable head URI", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [
        comment(1),
        comment(2, { in_reply_to_id: 1 }),
      ],
    });
    const session = await activeSession();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
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
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      fakeController(captured),
      async () => fakeDocument(20),
    );

    await projection.initialize();

    assert.strictEqual(captured.length, 1);
    assert.match(captured[0].uri.path, /^\/base\/src\/example\.ts$/);
    assert.strictEqual(captured[0].range.start.line, 5);

    projection.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("does not create a native thread when the reported line is outside the snapshot", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(1, { position: 50 })],
    });
    const session = await activeSession();
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      fakeController(captured),
      async () => fakeDocument(10),
    );

    await projection.initialize();

    assert.strictEqual(captured.length, 0);

    projection.dispose();
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
    const captured: CapturedThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
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
    conversations.dispose();
    session.dispose();
  });
});
