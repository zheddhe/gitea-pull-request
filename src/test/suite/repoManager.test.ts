import * as assert from "assert";
import {
  mergeServerConfigurations,
  parseRemoteUrl,
  repositoryListsEqual,
  type RepoInfo,
} from "../../context/repoManager";

suite("RepoManager remote classification", () => {
  test("accepts self-hosted Gitea HTTPS remotes when instance is known", () => {
    const info = parseRemoteUrl(
      "https://gitea.example.com/alice/project.git",
      "/workspace/project",
      { knownServerUrls: ["https://gitea.example.com"] },
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
    assert.strictEqual(info?.owner, "alice");
    assert.strictEqual(info?.repo, "project");
  });

  test("keeps unknown self-hosted remotes unmapped", () => {
    const info = parseRemoteUrl(
      "https://unknown.internal/alice/project.git",
      "/workspace/project",
      { knownServerUrls: ["https://gitea.example.com"] },
    );

    assert.strictEqual(info, undefined);
  });

  test("rejects GitHub HTTPS remotes in mixed workspaces", () => {
    const info = parseRemoteUrl(
      "https://github.com/alice/project.git",
      "/workspace/github-project",
      { knownServerUrls: ["https://gitea.example.com"] },
    );

    assert.strictEqual(info, undefined);
  });

  test("rejects GitHub SSH remotes even when a legacy Gitea override exists", () => {
    const info = parseRemoteUrl(
      "git@github.com:alice/project.git",
      "/workspace/github-project",
      { serverUrlOverride: "https://gitea.example.com" },
    );

    assert.strictEqual(info, undefined);
  });

  test("uses resolved OpenSSH identity for an SSH alias", () => {
    const info = parseRemoteUrl(
      "git@git-internal:alice/project.git",
      "/workspace/project",
      {
        knownServerUrls: ["https://gitea.example.com"],
        effectiveSsh: {
          host: "gitea.example.com",
          port: 2222,
          user: "git",
        },
      },
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
    assert.strictEqual(info?.owner, "alice");
    assert.strictEqual(info?.repo, "project");
  });

  test("uses explicit transport mapping for split SSH and API hosts", () => {
    const info = parseRemoteUrl(
      "ssh://git@git.internal:2222/alice/project.git",
      "/workspace/project",
      {
        configuredServers: [
          {
            url: "https://gitea.example.com",
            transports: [{ host: "git.internal", port: 2222 }],
          },
        ],
      },
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
  });

  test("preserves legacy override only as a private-host compatibility fallback", () => {
    const info = parseRemoteUrl(
      "git@git-internal:alice/project.git",
      "/workspace/project",
      { serverUrlOverride: "https://gitea.example.com" },
    );

    assert.strictEqual(info?.serverUrl, "https://gitea.example.com");
  });

  test("merges duplicate configured/authenticated instance identities", () => {
    const servers = mergeServerConfigurations([
      {
        url: "https://GITEA.EXAMPLE.COM/",
        label: "Company",
        transports: [{ host: "git.internal", port: 2222 }],
      },
      { url: "https://gitea.example.com" },
    ]);

    assert.deepStrictEqual(servers, [
      {
        url: "https://gitea.example.com",
        label: "Company",
        transports: [{ host: "git.internal", port: 2222 }],
      },
    ]);
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
