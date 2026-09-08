import * as assert from "assert";
import {
  normalizeGiteaInstanceUrl,
  parseGitRemote,
  parseSshGOutput,
  resolveRemoteToGiteaInstance,
  type GiteaServerConfiguration,
} from "../../context/giteaInstanceResolver";

suite("Gitea instance and transport resolver", () => {
  test("canonicalizes hostname case and trailing slash", () => {
    assert.strictEqual(
      normalizeGiteaInstanceUrl("https://GITEA.EXAMPLE.COM/"),
      "https://gitea.example.com",
    );
  });

  test("preserves custom ports and intentional base paths", () => {
    assert.strictEqual(
      normalizeGiteaInstanceUrl("https://Gitea.Example.com:8443/gitea/"),
      "https://gitea.example.com:8443/gitea",
    );
  });

  test("normalizes explicit default HTTPS port", () => {
    assert.strictEqual(
      normalizeGiteaInstanceUrl("https://gitea.example.com:443/"),
      "https://gitea.example.com",
    );
  });

  test("parses HTTPS remotes with custom ports", () => {
    assert.deepStrictEqual(
      parseGitRemote("https://gitea.example.com:8443/alice/project.git"),
      {
        kind: "https",
        host: "gitea.example.com",
        port: 8443,
        owner: "alice",
        repo: "project",
      },
    );
  });

  test("parses SCP-like SSH remotes", () => {
    assert.deepStrictEqual(parseGitRemote("git@gitea.example.com:alice/project.git"), {
      kind: "ssh",
      host: "gitea.example.com",
      user: "git",
      owner: "alice",
      repo: "project",
    });
  });

  test("parses ssh URI remotes and custom ports", () => {
    assert.deepStrictEqual(
      parseGitRemote("ssh://git@gitea.example.com:2222/alice/project.git"),
      {
        kind: "ssh",
        host: "gitea.example.com",
        port: 2222,
        user: "git",
        owner: "alice",
        repo: "project",
      },
    );
  });

  test("parses effective OpenSSH host, port and user", () => {
    assert.deepStrictEqual(
      parseSshGOutput("host work-git\nhostname git.internal.local\nuser git\nport 2222\n"),
      { host: "git.internal.local", port: 2222, user: "git" },
    );
  });

  test("maps SSH alias through its effective API hostname", () => {
    const remote = parseGitRemote("git@work-git:alice/project.git");
    assert.ok(remote && remote.kind === "ssh");
    assert.strictEqual(
      resolveRemoteToGiteaInstance(
        remote,
        [{ url: "https://gitea.example.com" }],
        { effectiveSsh: { host: "gitea.example.com", port: 2222, user: "git" } },
      ),
      "https://gitea.example.com",
    );
  });

  test("maps split SSH/API endpoints through explicit transport mapping", () => {
    const remote = parseGitRemote("ssh://git@git.internal.local:2222/alice/project.git");
    assert.ok(remote && remote.kind === "ssh");
    const servers: GiteaServerConfiguration[] = [
      {
        url: "https://gitea.company.example",
        transports: [{ host: "git.internal.local", port: 2222 }],
      },
    ];
    assert.strictEqual(
      resolveRemoteToGiteaInstance(remote, servers),
      "https://gitea.company.example",
    );
  });

  test("does not match explicit transport mapping when custom port differs", () => {
    const remote = parseGitRemote("ssh://git@git.internal.local:2200/alice/project.git");
    assert.ok(remote && remote.kind === "ssh");
    assert.strictEqual(
      resolveRemoteToGiteaInstance(remote, [
        {
          url: "https://gitea.company.example",
          transports: [{ host: "git.internal.local", port: 2222 }],
        },
      ]),
      undefined,
    );
  });

  test("keeps unknown hosts unmapped without legacy override", () => {
    const remote = parseGitRemote("git@unknown.internal:alice/project.git");
    assert.ok(remote);
    assert.strictEqual(
      resolveRemoteToGiteaInstance(remote, [{ url: "https://gitea.example.com" }]),
      undefined,
    );
  });

  test("never lets legacy override capture GitHub", () => {
    const remote = parseGitRemote("git@github.com:alice/project.git");
    assert.ok(remote);
    assert.strictEqual(
      resolveRemoteToGiteaInstance(remote, [], {
        legacyServerUrlOverride: "https://gitea.example.com",
      }),
      undefined,
    );
  });

  test("allows an explicitly configured Gitea endpoint on a normally excluded host", () => {
    const remote = parseGitRemote("https://github.com/alice/project.git");
    assert.ok(remote);
    assert.strictEqual(
      resolveRemoteToGiteaInstance(remote, [{ url: "https://github.com" }]),
      "https://github.com",
    );
  });

  test("returns unmapped when two transport mappings are ambiguous", () => {
    const remote = parseGitRemote("git@git.internal:alice/project.git");
    assert.ok(remote);
    assert.strictEqual(
      resolveRemoteToGiteaInstance(remote, [
        { url: "https://gitea-a.example", transports: [{ host: "git.internal" }] },
        { url: "https://gitea-b.example", transports: [{ host: "git.internal" }] },
      ]),
      undefined,
    );
  });
});
