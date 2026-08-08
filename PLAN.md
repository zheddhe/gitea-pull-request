# Gitea VSCode Extension Plan

## Goal

Build a VSCode extension that mirrors core GitHub extension workflows for Gitea:

- Pull requests: list, view details, checkout branches, create/review/comment/merge
- Actions-like CI view: workflows/runs/jobs/logs/status
- Auth/account/repo context management for self-hosted Gitea instances

## Scope (Phase 1) — ✅ Complete

1. Extension bootstrap and architecture
   - ✅ TypeScript VSCode extension scaffold
   - ✅ API client layer for Gitea REST (GraphQL not available in Gitea)
   - ✅ Configuration for multiple Gitea servers and tokens
2. Pull Request features
   - ✅ Tree views: open PRs grouped by repository (assigned/created/mentioned not yet implemented)
   - ✅ PR details panel: commits, files changed, checks, comments
   - ✅ PR actions: checkout branch, open diff, add review comment, approve/request changes, merge
3. CI/Actions-like features
   - ✅ Workflow/runs explorer (mapped to Gitea Actions APIs)
   - ✅ Run detail view with jobs/logs and status badges (steps not available via Gitea API)
   - ✅ Quick actions: rerun/cancel/open in browser
   - ✅ Live log streaming with auto-scroll
4. UX and reliability
   - ✅ Status bar context (repo/branch/account)
   - ✅ Command palette entries for all core operations
   - ✅ Pagination (load more) and robust error handling
   - ⚠️ Caching: basic job cache in CI provider, no global cache layer

## Scope (Phase 2)

- ❌ Notifications and activity feed
- ❌ Inline code review annotations in editor (existing annotations in PR detail panel)
- ❌ Advanced filtering/search/saved queries
- ❌ Enterprise/self-hosted admin controls

## Technical Notes

- ✅ Use VSCode APIs: TreeDataProvider, WebviewView, Authentication/SecretStorage
- ✅ Keep API layer strongly typed and isolated from UI commands
- ❌ Add integration tests for command handlers and API adapters (unit tests for repoContext only)

## Milestones

1. ✅ Bootstrap + auth + repo detection
2. ✅ PR list/detail/read-only
3. ✅ PR write operations (review/merge)
4. ✅ CI runs/jobs/logs
5. ✅ Polish + packaging + marketplace docs

## Known Limitations

- **Job steps**: Gitea API returns `"steps": null` — step-level details are not available in the tree view
- **Assigned/created/mentioned PR views**: Only open PRs per repository are shown
- **Single token per server**: Multiple users per server are not supported
- **No GraphQL**: Gitea does not provide a GraphQL API
