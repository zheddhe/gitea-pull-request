import * as assert from "assert";
import type { GiteaPullRequest } from "../../api/types";
import type { RepoInfo } from "../../context/repoManager";
import {
  PullRequestSnapshotDocumentProvider,
  createPullRequestSnapshotDocumentIdentity,
  createPullRequestSnapshotUri,
  parsePullRequestSnapshotUri,
} from "../../features/pullRequests/services/pullRequestSnapshotDocumentProvider";

suite("Pull request snapshot documents", () => {
  const repoInfo: RepoInfo = {
    serverUrl: "https://gitea.example",
    owner: "alice",
    repo: "repo",
    rootPath: "/workspace/repo",
    label: "alice/repo",
    key: "https://gitea.example|alice/repo",
  };

  const pr = {
    number: 42,
    base: {
      ref: "main",
      sha: "base-sha-123",
      repo: { full_name: "alice/repo" },
    },
    head: {
      ref: "feature/review",
      sha: "head-sha-456",
      repo: { full_name: "bob/repo" },
    },
  } as unknown as GiteaPullRequest;

  test("builds stable URI identities from immutable PR SHAs", () => {
    const identity = createPullRequestSnapshotDocumentIdentity(
      repoInfo,
      pr,
      "head",
      "src/example file.ts",
    );
    const first = createPullRequestSnapshotUri(identity);
    const second = createPullRequestSnapshotUri(identity);

    assert.strictEqual(first.toString(), second.toString());
    assert.deepStrictEqual(parsePullRequestSnapshotUri(first), identity);
    assert.strictEqual(identity.sha, "head-sha-456");
    assert.strictEqual(identity.repositoryFullName, "bob/repo");
  });

  test("changes document identity when the authoritative head changes", () => {
    const first = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(repoInfo, pr, "head", "src/app.ts"),
    );
    const refreshed = {
      ...pr,
      head: { ...pr.head, sha: "head-sha-789" },
    } as GiteaPullRequest;
    const second = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(
        repoInfo,
        refreshed,
        "head",
        "src/app.ts",
      ),
    );

    assert.notStrictEqual(first.toString(), second.toString());
  });

  test("loads fork head content from the exact head SHA", async () => {
    const calls: Array<{ repo: RepoInfo; ref: string; path: string }> = [];
    const provider = new PullRequestSnapshotDocumentProvider(
      {
        getFileContents: async (repo, ref, filePath) => {
          calls.push({ repo, ref, path: filePath });
          return "snapshot content";
        },
      },
      { getRepos: () => [repoInfo] },
    );
    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(
        repoInfo,
        pr,
        "head",
        "src/app.ts",
      ),
    );

    assert.strictEqual(
      await provider.provideTextDocumentContent(uri),
      "snapshot content",
    );
    assert.deepStrictEqual(calls, [
      {
        repo: {
          ...repoInfo,
          owner: "bob",
          repo: "repo",
          label: "bob/repo",
          key: "https://gitea.example|bob/repo",
        },
        ref: "head-sha-456",
        path: "src/app.ts",
      },
    ]);
  });

  test("returns an empty side for an added or deleted file", async () => {
    const provider = new PullRequestSnapshotDocumentProvider(
      {
        getFileContents: async () => {
          throw new Error("Gitea API error: 404 Not Found");
        },
      },
      { getRepos: () => [repoInfo] },
    );
    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(
        repoInfo,
        pr,
        "base",
        "src/new.ts",
      ),
    );

    assert.strictEqual(await provider.provideTextDocumentContent(uri), "");
  });

  test("does not hide authentication or transport failures", async () => {
    const provider = new PullRequestSnapshotDocumentProvider(
      {
        getFileContents: async () => {
          throw new Error("Not authenticated to https://gitea.example");
        },
      },
      { getRepos: () => [repoInfo] },
    );
    const uri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(
        repoInfo,
        pr,
        "head",
        "src/app.ts",
      ),
    );

    await assert.rejects(
      () => provider.provideTextDocumentContent(uri),
      /Not authenticated/,
    );
  });
});
