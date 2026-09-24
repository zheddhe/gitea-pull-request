import * as assert from "assert";
import { GiteaApiClient } from "../../api/giteaApiClient";
import type { RepoInfo } from "../../context/repoManager";

suite("Gitea pull request pagination", () => {
  const repoInfo = {
    key: "https://gitea.example.test::owner/repo",
    label: "owner/repo",
    serverUrl: "https://gitea.example.test",
    owner: "owner",
    repo: "repo",
  } as RepoInfo;

  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  function createClient(): GiteaApiClient {
    return new GiteaApiClient({
      getSession: async () => ({ token: "test-token" }),
    } as any);
  }

  test("loads every changed-file page in order", async () => {
    const requestedUrls: string[] = [];
    const pages = [
      Array.from({ length: 30 }, (_, index) => ({
        filename: `page-1/file-${index}.ts`,
      })),
      Array.from({ length: 30 }, (_, index) => ({
        filename: `page-2/file-${index}.ts`,
      })),
      Array.from({ length: 30 }, (_, index) => ({
        filename: `page-3/file-${index}.ts`,
      })),
      Array.from({ length: 14 }, (_, index) => ({
        filename: `page-4/file-${index}.ts`,
      })),
    ];

    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      const payload = pages[page - 1] ?? [];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "X-HasMore": page < pages.length ? "true" : "false" },
      });
    };

    const files = await createClient().listPRFiles(repoInfo, 67);

    assert.strictEqual(files.length, 104);
    assert.strictEqual(files[0].filename, "page-1/file-0.ts");
    assert.strictEqual(files[30].filename, "page-2/file-0.ts");
    assert.strictEqual(files[90].filename, "page-4/file-0.ts");
    assert.strictEqual(files[103].filename, "page-4/file-13.ts");
    assert.deepStrictEqual(
      requestedUrls.map((url) => Number(new URL(url).searchParams.get("page"))),
      [1, 2, 3, 4],
    );
    assert.ok(
      requestedUrls.every((url) => new URL(url).searchParams.get("limit") === "50"),
    );
  });

  test("keeps a small single-page pull request unchanged", async () => {
    const requestedPages: number[] = [];

    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedPages.push(Number(new URL(url).searchParams.get("page")));
      return new Response(
        JSON.stringify([
          { filename: "src/a.ts", status: "modified" },
          { filename: "src/b.ts", status: "added" },
        ]),
        {
          status: 200,
          headers: { "X-HasMore": "false" },
        },
      );
    };

    const files = await createClient().listPRFiles(repoInfo, 7);

    assert.deepStrictEqual(
      files.map((file) => [file.filename, file.status]),
      [
        ["src/a.ts", "modified"],
        ["src/b.ts", "added"],
      ],
    );
    assert.deepStrictEqual(requestedPages, [1]);
  });

  test("loads every commit page using the same pagination path", async () => {
    const requestedPages: number[] = [];
    const pages = [
      [{ sha: "commit-1" }, { sha: "commit-2" }],
      [{ sha: "commit-3" }],
    ];

    globalThis.fetch = async (input) => {
      const url = String(input);
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      return new Response(JSON.stringify(pages[page - 1] ?? []), {
        status: 200,
        headers: { "X-HasMore": page === 1 ? "true" : "false" },
      });
    };

    const commits = await createClient().listPRCommits(repoInfo, 67);

    assert.deepStrictEqual(
      commits.map((commit) => commit.sha),
      ["commit-1", "commit-2", "commit-3"],
    );
    assert.deepStrictEqual(requestedPages, [1, 2]);
  });

  test("loads every pull request review page", async () => {
    const requestedPages: number[] = [];
    const pages = [
      [{ id: 1, state: "APPROVED" }, { id: 2, state: "COMMENT" }],
      [{ id: 3, state: "REQUEST_CHANGES" }],
    ];

    globalThis.fetch = async (input) => {
      const url = String(input);
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      return new Response(JSON.stringify(pages[page - 1] ?? []), {
        status: 200,
        headers: { "X-HasMore": page === 1 ? "true" : "false" },
      });
    };

    const reviews = await createClient().listReviews(repoInfo, 67);

    assert.deepStrictEqual(
      reviews.map((review) => review.id),
      [1, 2, 3],
    );
    assert.deepStrictEqual(requestedPages, [1, 2]);
  });

  test("falls back to an empty terminal page when pagination headers are absent", async () => {
    const requestedPages: number[] = [];

    globalThis.fetch = async (input) => {
      const url = String(input);
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      const payload =
        page === 1
          ? [{ filename: "src/a.ts" }]
          : page === 2
            ? [{ filename: "src/b.ts" }]
            : [];
      return new Response(JSON.stringify(payload), { status: 200 });
    };

    const files = await createClient().listPRFiles(repoInfo, 67);

    assert.deepStrictEqual(
      files.map((file) => file.filename),
      ["src/a.ts", "src/b.ts"],
    );
    assert.deepStrictEqual(requestedPages, [1, 2, 3]);
  });

  test("rejects the whole collection when a later page fails", async () => {
    globalThis.fetch = async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      if (page === 1) {
        return new Response(JSON.stringify([{ filename: "src/a.ts" }]), {
          status: 200,
          headers: { "X-HasMore": "true" },
        });
      }
      return new Response("temporary failure", {
        status: 500,
        statusText: "Internal Server Error",
      });
    };

    await assert.rejects(
      () => createClient().listPRFiles(repoInfo, 67),
      /Internal Server Error|temporary failure|500/,
    );
  });
});
