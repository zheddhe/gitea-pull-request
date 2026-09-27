# Gitea Pull Request 1.1.1 — Release record

`1.1.1` is a corrective release for pull-request data integrity. It fixes incomplete PR information on large or long-lived pull requests where Gitea paginates changed files, commits or reviews.

## Release scope

| Issue | Scope | Status |
| --- | --- | --- |
| #67 | Large pull requests show incomplete changed-file summary | Completed |
| #67 follow-up | PR commit pagination | Completed |
| #67 follow-up | PR review pagination on both review API paths | Completed |

## Delivered behavior

### Complete changed-file collection

- `listPRFiles()` now retrieves every page returned by Gitea.
- `Changes in Pull Request` receives the complete file collection.
- File count and Reviewed/Viewed denominator are no longer based on the first page only.
- Reviewed-file reconciliation now sees the complete current PR file set.
- Additions/deletions derived from loaded file data are no longer silently based on a truncated collection.

### Complete commit collection

- `listPRCommits()` now retrieves all commit pages.
- PR Detail commit information no longer truncates on large or long-lived pull requests.

### Complete review collection

- `GiteaApiClient.listReviews()` retrieves all review pages.
- `PullRequestReviewApi.listReviews()`, used by the review workflow, also retrieves the complete review history.
- Effective review state and review-history presentation are therefore calculated from the full server-side review collection rather than a first-page subset.

### Pagination safety

- Server ordering is preserved exactly.
- Items are not deduplicated or reordered.
- A failure on a later page fails the complete request instead of returning a partial collection as if it were authoritative.
- The shared API client consumes Gitea pagination headers when available and uses a conservative fallback when those headers are absent.

## Validation

Automated regression coverage includes:

- a 104-file pull request spanning multiple pages;
- multi-page PR commit retrieval;
- multi-page PR review retrieval through the shared API client;
- multi-page review retrieval and normalization through the dedicated review-workflow API client;
- unchanged behavior for small single-page PRs;
- pagination fallback when headers are unavailable;
- failure propagation when a later page returns an error.

The functional validation for #67 must confirm against a real multi-page Gitea PR that:

- the extension shows exactly the same changed-file count as Gitea;
- the `Changes in Pull Request` tree contains the complete set of files;
- the Reviewed/Viewed denominator uses the complete changed-file collection;
- commit history is complete when it spans more than one API page;
- review history and effective review state include reviews beyond the first page.

The investigated large-PR scenario has been manually re-tested successfully before release preparation.

## Compatibility

No compatibility baseline changes are introduced by 1.1.1.

- **VS Code:** 1.133.0 or later
- **Gitea:** 1.26.4 minimum supported compatibility floor
- **Gitea 1.27.x+** recommended for the complete review experience
- **Gitea Runner:** 3.x.x or later recommended for the current Actions / CI experience
- **Node.js:** 24.x build / CI baseline

## Documentation status

The 1.1.1 release candidate aligns:

- `README.md` — unchanged because the patch restores already-documented PR/review behavior rather than adding a new user-facing feature;
- `CHANGELOG.md` — 1.1.1 release notes and compatibility statement;
- `ROADMAP.md` — patch release recorded under the existing 1.1.x line;
- `TESTING.md` — pagination regression suites documented;
- `RELEASING.md` — unchanged version-independent release procedure;
- `package.json` / `package-lock.json` — promoted to 1.1.1 before release.

## Release gate

Immediately before tagging, validate the promoted release candidate under Node.js 24:

```bash
make verify
make reinstall-vsix
```

Confirm the installed artifact is:

```text
.artifacts/vsix/gitea-pull-request-1.1.1.vsix
```

Final smoke scope:

- open a large multi-page PR and compare changed-file count with Gitea;
- confirm the complete `Changes in Pull Request` tree;
- confirm Reviewed/Viewed denominator uses the complete file set;
- inspect PR Detail commit history;
- inspect review history and effective review state;
- verify a normal small PR remains unchanged;
- run a brief Issue and CI / Actions smoke check to confirm the patch did not regress unrelated primary views.

## Publication sequence

After the release candidate is validated:

1. merge the validated release PR into `main`;
2. tag the merged commit as `v1.1.1`;
3. let `.github/workflows/release.yml` rebuild and verify the exact tagged source;
4. confirm `gitea-pull-request-1.1.1.vsix` is attached to the draft GitHub Release;
5. review the draft release notes and publish the GitHub Release;
6. upload that same verified VSIX to the Visual Studio Marketplace.

The operational procedure remains documented in [`RELEASING.md`](RELEASING.md).
