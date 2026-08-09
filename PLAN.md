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
   - ✅ Tree views: open PRs grouped by repository with category folders (All Open, Waiting for my review, Created by me)
   - ✅ PR sidebar icons colored by review status (yellow/green/red)
   - ✅ PR diff tree view: dedicated sidebar panel with directory tree, native file icons, checkbox tracking, and `vscode.diff` editor
   - ✅ PR details panel: unified tabbed layout (Details, Reviews, Commits)
   - ✅ PR actions: checkout branch, open diff, add review comment, approve/request changes, merge
   - ✅ Inline edit form: global overlay above tabs to edit title, body, and base branch
   - ✅ Merge status icon: colored icon in title row showing latest review status
3. Issue features
   - ✅ Issue details panel: unified tabbed layout (Details, History)
   - ✅ Inline edit form: edit title and body
   - ✅ `updateIssue()` API method: PATCH `/repos/{owner}/{repo}/issues/{number}`
4. CI/Actions-like features
   - ✅ Workflow/runs explorer (mapped to Gitea Actions APIs)
   - ✅ Run detail view with jobs/logs and status badges (steps not available via Gitea API)
   - ✅ Quick actions: rerun/cancel/open in browser
   - ✅ Live log streaming with auto-scroll
5. UX and reliability
   - ✅ Status bar context (repo/branch/account)
   - ✅ Command palette entries for all core operations
   - ✅ Pagination (load more) and robust error handling
   - ✅ Output channel for debug logging
   - ⚠️ Caching: basic job cache in CI provider, no global cache layer

## Scope (Phase 2)

- ❌ Notifications and activity feed
- ❌ Inline code review annotations in editor (existing annotations in PR detail panel)
- ❌ Advanced filtering/search/saved queries
- ❌ Markdown rendering in detail views (`marked` library present but not yet integrated)

## Technical Notes

- ✅ Use VSCode APIs: TreeDataProvider, WebviewView, Authentication/SecretStorage
- ✅ Keep API layer strongly typed and isolated from UI commands
- ✅ `getFileContents()` API method: fetch file content from a specific branch
- ❌ Add integration tests for command handlers and API adapters (unit tests for repoContext only)

## Milestones

1. ✅ Bootstrap + auth + repo detection
2. ✅ PR list/detail/read-only
3. ✅ PR write operations (review/merge)
4. ✅ CI runs/jobs/logs
5. ✅ Polish + packaging + marketplace docs
6. ✅ Enhanced PR/Issue panels with unified tabs, diff tree, and review status icons (7.0.0-fork1.0.0)

## Known Limitations

- **Job steps**: Gitea API returns `"steps": null` — step-level details are not available in the tree view
- **Assigned/created/mentioned PR views**: Only open PRs per repository are shown
- **Single token per server**: Multiple users per server are not supported
- **No GraphQL**: Gitea does not provide a GraphQL API
- **Markdown rendering**: Detail views currently render body/comments as plain text in `<pre>` tags; `marked` library is present but not yet integrated
