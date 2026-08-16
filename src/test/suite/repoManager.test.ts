import * as assert from "assert";
import {
  parseRemoteUrl,
  repositoryListsEqual,
  type RepoInfo,
} from "../../context/repoManager";

suite("RepoManager remote classification", () => {
  test("accepts self-hosted Gitea HTTPS remotes", () => {
    const info = parseRemoteUrl(
      "https://gitea.example.com/alice/project.git",
      "/workspace/project",
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
    assert.strictEqual(info?.owner, "alice");
    assert.strictEqual(info?.repo, "project");
  });

  test("rejects GitHub HTTPS remotes in mixed workspaces", () => {
    const info = parseRemoteUrl(
      "https://github.com/alice/project.git",
      "/workspace/github-project",
    );

    assert.strictEqual(info, undefined);
  });

  test("rejects GitHub SSH remotes even when a Gitea server override exists", () => {
    const info = parseRemoteUrl(
      "git@github.com:alice/project.git",
      "/workspace/github-project",
      { serverUrlOverride: "https://gitea.example.com" },
    );

    assert.strictEqual(info, undefined);
  });

  test("uses an explicit Gitea server override for an SSH alias", () => {
    const info = parseRemoteUrl(
      "git@git-internal:alice/project.git",
      "/workspace/project",
      {
        serverUrlOverride: "https://gitea.example.com",
        knownServerUrls: ["https://gitea.example.com"],
      },
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
    assert.strictEqual(info?.owner, "alice");
    assert.strictEqual(info?.repo, "project");
  });

  test("filters unrelated hosts once Gitea servers are known", () => {
    const info = parseRemoteUrl(
      "https://git.other.example/alice/project.git",
      "/workspace/other-project",
      { knownServerUrls: ["https://gitea.example.com"] },
    );

    assert.strictEqual(info, undefined);
  });

  test("accepts a remote matching an authenticated Gitea server", () => {
    const info = parseRemoteUrl(
      "git@gitea.example.com:alice/project.git",
      "/workspace/project",
      { knownServerUrls: ["https://gitea.example.com"] },
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
  });

  test("treats repeated detection of the same repository as unchanged", () => {
    const first = repo("main");
    const second = { ...first };

    assert.strictEqual(repositoryListsEqual([first], [second]), true);
  });

  test("detects a semantic repository change when HEAD branch changes", () => {
    assert.strictEqual(
      repositoryListsEqual([repo("main")], [repo("feature/phase-3")]),
      false,
    );
  });

  test("repository comparison is independent of detection order", () => {
    const first = repo("main");
    const second: RepoInfo = {
      ...repo("develop"),
      owner: "bob",
      repo: "other",
      label: "bob/other",
      key: "https://gitea.example.com|bob/other",
      rootPath: "/workspace/other",
    };

    assert.strictEqual(
      repositoryListsEqual([first, second], [second, first]),
      true,
    );
  });
});

function repo(currentBranch: string): RepoInfo {
  return {
    serverUrl: "https://gitea.example.com",
    owner: "alice",
    repo: "project",
    currentBranch,
    rootPath: "/workspace/project",
    label: "alice/project",
    key: "https://gitea.example.com|alice/project",
  };
}
