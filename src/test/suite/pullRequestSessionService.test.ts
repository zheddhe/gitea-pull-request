import * as assert from "assert";
import { GiteaPullRequest, GiteaRepository, GiteaUser } from "../../api/types";
import { RepositoryRef } from "../../features/pullRequests/domain/pullRequestState";
import { PullRequestSessionService } from "../../features/pullRequests/services/pullRequestSessionService";

const user: GiteaUser = {
  id: 1,
  login: "tester",
  full_name: "Test User",
  email: "tester@example.com",
  avatar_url: "",
};

const repository: GiteaRepository = {
  id: 1,
  name: "repo",
  full_name: "tester/repo",
  owner: user,
  html_url: "https://gitea.example/tester/repo",
  default_branch: "main",
  private: false,
  fork: false,
};

const repositoryRef: RepositoryRef = {
  key: "https://gitea.example|tester/repo",
  owner: "tester",
  name: "repo",
  fullName: "tester/repo",
};

const pullRequest: GiteaPullRequest = {
  id: 10,
  number: 42,
  title: "Test pull request",
  body: "",
  state: "open",
  html_url: "https://gitea.example/tester/repo/pulls/42",
  user,
  head: {
    label: "tester:feature/test",
    ref: "feature/test",
    sha: "head-sha",
    repo: repository,
  },
  base: {
    label: "tester:main",
    ref: "main",
    sha: "base-sha",
    repo: repository,
  },
  merged: false,
  created_at: "2026-08-16T00:00:00Z",
  updated_at: "2026-08-16T00:00:00Z",
  comments: 0,
  review_comments: 0,
};

suite("PullRequestSessionService", () => {
  test("starts idle and synchronizes context keys", async () => {
    const context = new Map<string, unknown>();
    const service = new PullRequestSessionService(async (key, value) => {
      context.set(key, value);
    });

    await service.initialize();

    assert.deepStrictEqual(service.current, { kind: "idle" });
    assert.strictEqual(context.get("gitea.prSession.active"), false);
    assert.strictEqual(context.get("gitea.prSession.creating"), false);
    assert.strictEqual(context.get("gitea.prSession.merged"), false);
    assert.strictEqual(context.get("gitea.prSession.checkedOut"), false);
    assert.strictEqual(context.get("gitea.prSession.repositoryKey"), undefined);
    assert.strictEqual(context.get("gitea.prSession.pullRequestNumber"), undefined);

    service.dispose();
  });

  test("transitions through creating, active, merged and idle", async () => {
    const context = new Map<string, unknown>();
    const service = new PullRequestSessionService(async (key, value) => {
      context.set(key, value);
    });

    await service.startCreating(repositoryRef, "main", "feature/test");
    const creatingState = service.current;
    assert.strictEqual(creatingState.kind, "creating");
    assert.strictEqual(context.get("gitea.prSession.creating"), true);
    assert.strictEqual(
      context.get("gitea.prSession.repositoryKey"),
      repositoryRef.key,
    );

    await service.activate(repositoryRef, pullRequest);
    const activeState = service.current;
    assert.strictEqual(activeState.kind, "active");
    if (activeState.kind === "active") {
      assert.deepStrictEqual(activeState.repository, repositoryRef);
      assert.strictEqual(activeState.pullRequest.number, 42);
    }
    assert.strictEqual(context.get("gitea.prSession.active"), true);
    assert.strictEqual(context.get("gitea.prSession.checkedOut"), false);
    assert.strictEqual(context.get("gitea.prSession.pullRequestNumber"), 42);

    await service.setCheckoutState({
      kind: "checkedOut",
      localBranch: "feature/test",
    });
    const checkedOutState = service.current;
    assert.strictEqual(checkedOutState.kind, "active");
    if (checkedOutState.kind === "active") {
      assert.deepStrictEqual(checkedOutState.checkoutState, {
        kind: "checkedOut",
        localBranch: "feature/test",
      });
    }
    assert.strictEqual(context.get("gitea.prSession.checkedOut"), true);

    await service.markMerged(
      repositoryRef,
      { ...pullRequest, merged: true, state: "closed" },
      { localBranchExists: true, remoteBranchExists: true },
    );
    const mergedState = service.current;
    assert.strictEqual(mergedState.kind, "merged");
    assert.strictEqual(context.get("gitea.prSession.merged"), true);
    assert.strictEqual(context.get("gitea.prSession.active"), false);

    await service.clear();
    const idleState = service.current;
    assert.deepStrictEqual(idleState, { kind: "idle" });
    assert.strictEqual(context.get("gitea.prSession.merged"), false);
    assert.strictEqual(context.get("gitea.prSession.repositoryKey"), undefined);
    assert.strictEqual(context.get("gitea.prSession.pullRequestNumber"), undefined);

    service.dispose();
  });

  test("clears an active session when its repository disappears", async () => {
    const service = new PullRequestSessionService(async () => undefined);
    await service.activate(repositoryRef, pullRequest);

    const kept = await service.invalidateIfRepositoryUnavailable([
      repositoryRef.key,
      "https://gitea.example|tester/other",
    ]);
    assert.strictEqual(kept, false);
    assert.strictEqual(service.current.kind, "active");

    const invalidated = await service.invalidateIfRepositoryUnavailable([
      "https://gitea.example|tester/other",
    ]);
    assert.strictEqual(invalidated, true);
    assert.deepStrictEqual(service.current, { kind: "idle" });

    service.dispose();
  });
});
