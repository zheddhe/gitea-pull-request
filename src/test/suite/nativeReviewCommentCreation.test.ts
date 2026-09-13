import * as assert from "assert";
import * as vscode from "vscode";
import type { GiteaPullRequest } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import { NativeReviewProjectionService } from "../../features/pullRequests/services/nativeReviewProjectionService";
import { PullRequestConversationService } from "../../features/pullRequests/services/pullRequestConversationService";
import { PullRequestReviewSessionService } from "../../features/pullRequests/services/pullRequestReviewSessionService";
import { PullRequestSessionService } from "../../features/pullRequests/services/pullRequestSessionService";
import { createPullRequestSnapshotDocumentIdentity, createPullRequestSnapshotUri } from "../../features/pullRequests/services/pullRequestSnapshotDocumentProvider";

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

const rawDiff = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 111..222 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -2,3 +2,4 @@",
  " keep-2",
  "-old-3",
  "+new-3",
  "+new-4",
  " keep-4",
].join("\n");

interface FakeThread extends vscode.CommentThread {
  disposed: boolean;
}

function fakeController(captured: FakeThread[]): vscode.CommentController {
  const controller = {
    id: "test.giteaReview",
    label: "Test Gitea Review",
    commentingRangeProvider: undefined,
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
        disposed: false,
        dispose() {
          this.disposed = true;
        },
      } as unknown as FakeThread;
      captured.push(thread);
      return thread;
    },
    dispose: () => undefined,
  } as unknown as vscode.CommentController;
  return controller;
}

function fakeDocument(uri: vscode.Uri, lineCount = 20): vscode.TextDocument {
  return {
    uri,
    lineCount,
    lineAt: (line: number) => ({ range: new vscode.Range(line, 0, line, 10) }),
  } as unknown as vscode.TextDocument;
}

async function activeSession(): Promise<PullRequestSessionService> {
  const session = new PullRequestSessionService(async () => undefined);
  await session.initialize();
  await session.activate(repositoryRef, pullRequest);
  return session;
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!condition()) {
    if (Date.now() >= deadline) assert.fail(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

suite("Native review comment creation", () => {
  test("exposes only exact PR diff lines as native commenting ranges", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [],
      getPRRawDiff: async () => rawDiff,
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: FakeThread[] = [];
    const controller = fakeController(captured);
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      controller,
      async (uri) => fakeDocument(uri),
    );
    await projection.initialize();

    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(repoInfo, pullRequest, "head", "src/example.ts"),
    );
    const provider = controller.commentingRangeProvider;
    assert.ok(provider);
    const ranges = await provider.provideCommentingRanges(fakeDocument(uri), {} as vscode.CancellationToken);
    assert.deepStrictEqual(
      (ranges ?? []).map((range) => range.start.line + 1),
      [2, 3, 4, 5],
    );

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("queues a validated native comment into the shared pending transaction", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [],
      getPRRawDiff: async () => rawDiff,
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: FakeThread[] = [];
    const controller = fakeController(captured);
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      controller,
      async (uri) => fakeDocument(uri),
    );
    await projection.initialize();

    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(repoInfo, pullRequest, "head", "src/example.ts"),
    );
    const thread = controller.createCommentThread(uri, new vscode.Range(2, 0, 2, 0), []);
    await projection.queueInlineComment({ thread, text: "please change this" });

    const sessionState = pending.get(repoInfo, 42);
    assert.strictEqual(sessionState.inlineComments.length, 1);
    assert.deepStrictEqual(
      {
        path: sessionState.inlineComments[0].path,
        newPosition: sessionState.inlineComments[0].new_position,
        oldPosition: sessionState.inlineComments[0].old_position,
        body: sessionState.inlineComments[0].body,
      },
      {
        path: "src/example.ts",
        newPosition: 3,
        oldPosition: 0,
        body: "please change this",
      },
    );
    assert.strictEqual(thread.comments.length, 1);
    assert.strictEqual(thread.contextValue, "giteaPendingInlineReview");

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });

  test("projects a pending inline comment created by another surface", async () => {
    const conversations = new PullRequestConversationService({
      listAllPRReviewComments: async () => [],
      getPRRawDiff: async () => rawDiff,
    });
    const session = await activeSession();
    const pending = new PullRequestReviewSessionService();
    const captured: FakeThread[] = [];
    const projection = new NativeReviewProjectionService(
      conversations,
      { getRepos: () => [repoInfo] },
      session,
      pending,
      fakeController(captured),
      async (uri) => fakeDocument(uri),
    );
    await projection.initialize();

    pending.queueInlineComment(repoInfo, 42, {
      id: "webview-inline-1",
      path: "src/example.ts",
      new_position: 4,
      old_position: 0,
      body: "from PR Detail",
    });
    await waitFor(() => captured.length === 1, "pending inline native projection");

    assert.strictEqual(captured[0].range.start.line, 3);
    assert.strictEqual(captured[0].contextValue, "giteaPendingInlineReview");
    assert.strictEqual(captured[0].comments.length, 1);

    projection.dispose();
    pending.dispose();
    conversations.dispose();
    session.dispose();
  });
});
