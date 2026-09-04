import * as assert from "assert";
import type { GiteaApiClient } from "../../api/giteaApiClient";
import type {
  GiteaPullRequest,
  GiteaReviewComment,
  GiteaUser,
} from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import {
  createPullRequestConversationApiView,
  PullRequestConversationService,
} from "../../features/pullRequests/services/pullRequestConversationService";

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
  base: { sha: "base-a" },
  head: { sha: "head-a" },
} as unknown as GiteaPullRequest;

function comment(id: number, position = 10): GiteaReviewComment {
  return {
    id,
    user,
    body: `comment ${id}`,
    path: "src/example.ts",
    position,
    original_position: position,
    created_at: `2026-09-04T20:00:${String(id).padStart(2, "0")}Z`,
    updated_at: `2026-09-04T20:00:${String(id).padStart(2, "0")}Z`,
  };
}

suite("Pull request conversation service", () => {
  test("normalizes persisted comments once per immutable PR snapshot", async () => {
    let calls = 0;
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => {
        calls += 1;
        return [comment(1), comment(2)];
      },
    });

    const first = await service.load(repoInfo, pullRequest);
    const second = await service.load(repoInfo, pullRequest);

    assert.strictEqual(calls, 1);
    assert.strictEqual(first.comments.length, 2);
    assert.strictEqual(first.conversations.length, 1);
    assert.deepStrictEqual(second.conversations.map((item) => item.root.id), [1]);
    service.dispose();
  });

  test("creates a distinct snapshot when the authoritative head changes", async () => {
    let calls = 0;
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => {
        calls += 1;
        return [comment(calls, 10 + calls)];
      },
    });
    const refreshed = {
      ...pullRequest,
      head: { ...pullRequest.head, sha: "head-b" },
    } as GiteaPullRequest;

    const first = await service.load(repoInfo, pullRequest);
    const second = await service.load(repoInfo, refreshed);

    assert.strictEqual(calls, 2);
    assert.strictEqual(first.headSha, "head-a");
    assert.strictEqual(second.headSha, "head-b");
    service.dispose();
  });

  test("force refresh replaces the cached normalized snapshot", async () => {
    let calls = 0;
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => {
        calls += 1;
        return [comment(calls, 10 + calls)];
      },
    });

    const first = await service.load(repoInfo, pullRequest);
    const second = await service.load(repoInfo, pullRequest, true);

    assert.strictEqual(calls, 2);
    assert.notStrictEqual(first.comments[0].id, second.comments[0].id);
    service.dispose();
  });

  test("returns defensive arrays so projections cannot mutate service state", async () => {
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(1), comment(2)],
    });

    const snapshot = await service.load(repoInfo, pullRequest);
    snapshot.comments.length = 0;
    snapshot.conversations[0].replies.length = 0;

    const cached = service.get(repoInfo, pullRequest);
    assert.strictEqual(cached?.comments.length, 2);
    assert.strictEqual(cached?.conversations[0].replies.length, 1);
    service.dispose();
  });

  test("emits normalized snapshots only when data is loaded or refreshed", async () => {
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(1)],
    });
    const heads: string[] = [];
    const disposable = service.onDidChange((snapshot) => heads.push(snapshot.headSha));

    await service.load(repoInfo, pullRequest);
    await service.load(repoInfo, pullRequest);
    await service.load(repoInfo, pullRequest, true);

    assert.deepStrictEqual(heads, ["head-a", "head-a"]);
    disposable.dispose();
    service.dispose();
  });

  test("routes matching PR detail review comments through the shared store", async () => {
    let storeCalls = 0;
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => {
        storeCalls += 1;
        return [comment(storeCalls)];
      },
    });
    let delegatedCalls = 0;
    const api = {
      listAllPRReviewComments: async () => {
        delegatedCalls += 1;
        return [comment(99)];
      },
    } as unknown as GiteaApiClient;
    const view = createPullRequestConversationApiView(
      api,
      service,
      repoInfo,
      pullRequest,
    );

    const comments = await view.listAllPRReviewComments(repoInfo, pullRequest.number);

    assert.deepStrictEqual(comments.map((item) => item.id), [1]);
    assert.strictEqual(storeCalls, 1);
    assert.strictEqual(delegatedCalls, 0);
    service.dispose();
  });

  test("delegates non-matching review comment requests to the original API", async () => {
    const service = new PullRequestConversationService({
      listAllPRReviewComments: async () => [comment(1)],
    });
    let delegatedCalls = 0;
    const api = {
      listAllPRReviewComments: async () => {
        delegatedCalls += 1;
        return [comment(99)];
      },
    } as unknown as GiteaApiClient;
    const view = createPullRequestConversationApiView(
      api,
      service,
      repoInfo,
      pullRequest,
    );

    const comments = await view.listAllPRReviewComments(repoInfo, 43);

    assert.deepStrictEqual(comments.map((item) => item.id), [99]);
    assert.strictEqual(delegatedCalls, 1);
    service.dispose();
  });
});
