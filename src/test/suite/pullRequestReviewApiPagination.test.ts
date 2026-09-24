import * as assert from "assert";
import { PullRequestReviewApi } from "../../features/pullRequests/services/pullRequestReviewApi";
import type { RepoInfo } from "../../context/repoManager";

suite("PullRequestReviewApi pagination", () => {
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

  test("loads and normalizes all review pages", async () => {
    const requestedPages: number[] = [];

    globalThis.fetch = async (input) => {
      const url = String(input);
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);

      const payload =
        page === 1
          ? [
              {
                id: 1,
                state: "APPROVED",
                body: null,
                submitted_at: null,
                stale: false,
                user: { id: 10, login: "alice" },
              },
              {
                id: 2,
                state: "COMMENT",
                body: "page one",
                submitted_at: "2026-09-24T10:00:00Z",
                stale: false,
                user: { id: 11, login: "bob" },
              },
            ]
          : page === 2
            ? [
                {
                  id: 3,
                  state: "REQUEST_CHANGES",
                  body: "page two",
                  submitted_at: "2026-09-24T11:00:00Z",
                  stale: true,
                  user: { id: 12, login: "carol" },
                },
              ]
            : [];

      return new Response(JSON.stringify(payload), { status: 200 });
    };

    const api = new PullRequestReviewApi({
      getSession: async () => ({ token: "test-token" }),
    } as any);

    const reviews = await api.listReviews(repoInfo, 67);

    assert.deepStrictEqual(
      reviews.map((review) => review.id),
      [1, 2, 3],
    );
    assert.strictEqual(reviews[0].body, "");
    assert.strictEqual(reviews[0].submitted_at, "");
    assert.strictEqual(reviews[2].stale, true);
    assert.deepStrictEqual(requestedPages, [1, 2, 3]);
  });
});
