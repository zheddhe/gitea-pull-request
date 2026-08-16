# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the standalone product line follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - Unreleased

### Added

- Dedicated **Pull Request #N Merged** post-merge sidebar WebviewView driven by the `merged` pull-request session state.
- Automatic focus of the post-merge view after a successful sidebar merge.
- `BranchCleanupService` foundation for resolving the actual local and remote head/base branch identities before any destructive cleanup action.
- Independent local/remote branch identity handling, including local aliases that track a differently named remote PR branch.
- Post-merge branch-state diagnostics and manual refresh.
- Pure cleanup planning for upcoming local/remote deletion actions, including whether checkout of the base branch is required first.
- Tests covering exact and aliased local branches, remote-only branches, multiple remotes, origin preference, cleanup eligibility and safe-checkout planning.

### Changed

- The post-merge workflow no longer ends with the Phase 3 Changes/Review views simply disappearing: the `merged` session now has an explicit sidebar successor state.
- Merge-readiness presentation now explains `mergeable=false` as an automatic-merge blocker requiring conflict or other server-side mergeability resolution before merge. Gitea remains authoritative because its public API does not reliably expose the exact conflicting-file list for this state.
- Phase 4 cleanup decisions are based on resolved Git identities rather than assuming the PR head name, local branch name and remote branch name are identical.

### Validation

Current Phase 4 foundation validation covers:

- post-merge transition into the dedicated merged view;
- exact merged PR/repository/head/base context preservation;
- local and remote branch identity resolution;
- local alias tracking independent from the PR remote branch name;
- remote-only branch state and multiple-remotes/origin preference;
- safe cleanup planning with checkout-before-delete requirements;
- explicit merge blocking for a PR reported by Gitea as not mergeable;
- 36 extension/domain tests passing before the Phase 4 destructive cleanup implementation.

### Remaining Phase 4 work

- Execute checkout-base and local branch deletion safely.
- Execute remote branch deletion with independent local/remote selection.
- Add **Create New Pull Request...** and coherent lifecycle completion/decline transitions.
- Complete interactive cleanup validation, documentation review and the `0.5.0` release gate.

## [0.4.0] - 2026-08-16

### Added

- Contextual **Review Pull Request #N** sidebar WebviewView bound to the active pull-request session.
- Top-level PR comments directly from the review sidebar.
- Approve and Request Changes review actions with Gitea permission/errors left authoritative.
- Merge-readiness summary combining PR state, current reviews, target-branch policy and combined CI/check status.
- Repository-supported merge method selection for merge commit, squash and rebase, with persisted workspace preference.
- Safe **Checkout '<base>'** action scoped to the active Gitea repository.
- Explicit `active -> merged` session transition after successful merge, including local/remote head-branch presence for the Phase 4 cleanup flow.
- Diagnostic logging for PR session/coordinator, review-readiness API calls and merge attempts.

### Changed

- **Waiting for my review** is expanded by default and uses a neutral folder presentation; status coloring remains on individual PR items where it is meaningful.
- Pull-request readiness treats a loaded zero-diff PR as a terminal state and blocks merge when the head is already contained in the target branch.
- Repository detection emits change events only when the detected repository set or relevant repository state actually changes, avoiding cascaded sidebar/readiness refreshes.
- The legacy PR-list child no longer fabricates `+0 / -0 · 0 file(s) changed` when Gitea's list response does not provide diff statistics; the statistics row is omitted instead.
- After a successful merge, active Changes/Review views leave the active workflow as the session enters `merged`; the post-merge experience is owned by Phase 4.

### Fixed

- Endless reload of **Changes in Pull Request** when a valid PR diff is empty (`files = []`).
- Repeated merge-readiness API bursts caused by semantically unchanged Git/repository detection events.
- Review view hangs caused by unbounded/unnormalized readiness and review API paths.
- Merge attempts are no longer offered for PRs with no content left to merge.
- Transient Gitea mergeability `405 Please try again later` responses are handled defensively while preserving non-transient server rejections.

### Validation

Interactive Phase 3 validation covered pending/failing/successful CI checks, review states including self-approval restrictions, no-diff blocking, real merge with content, the `active -> merged` transition and elimination of the observed diff/repository refresh loops.

## [0.3.0] - 2026-08-16

### Added

- Dedicated sidebar-first **Create Pull Request** WebviewView in the Gitea Pull Request Activity Bar.
- Explicit repository selection for PR creation in multi-repository workspaces.
- BASE and MERGE/head branch selection with validation preventing identical source/target branches.
- Editable pull-request title and description with branch-based title prefill.
- Creation-session orchestration through `PullRequestSessionService` (`idle -> creating -> active`).
- Automatic PR-tree refresh and activation of the newly created PR after successful creation.
- Files Changed for the selected base/head pair.
- QuickPick metadata flows for reviewers, assignees, labels and milestone where supported by Gitea APIs.
- Create Draft support using Gitea's WIP convention.
- Create-flow/domain tests for branch validation, prefill and draft behavior.
- Guarded `make promote RELEASE_VERSION=x.y.z` workflow for explicit phase/release version promotion.

### Changed

- The primary **Create Pull Request** action opens the sidebar creation workflow instead of the legacy prompt sequence.
- The create action remains available when the Pull Requests tree contains no open PRs.
- Re-invoking Create while a creation session is already active refocuses the existing creation view rather than creating another draft state.
- Projects are intentionally not exposed as PR metadata while the extension cannot reliably read and persist PR ↔ Project assignment through the supported Gitea API surface.
- Detailed visual/ergonomic refinement is deferred to the dedicated product-polish phase unless it blocks workflow use.

### Fixed

- Creating a PR is no longer accidentally unavailable when the Pull Requests list is empty.
- Cancel clears the `creating` session state so the sidebar cannot retain a stale creation context.

## [0.2.0] - 2026-08-16

### Added

- Explicit active pull-request workspace/session context with repository identity.
- `gitea.activatePR` and `gitea.clearActivePR` commands.
- Session coordinator binding the active PR to the contextual `Changes in Pull Request` tree.
- Context keys exposing active PR repository and pull-request number.
- Dedicated `Open Full Pull Request Details` secondary workflow.
- Tests covering active PR repository identity and stale-session invalidation.

### Changed

- `Changes in Pull Request` is driven by the active PR session during the incremental migration.
- Repository detection is scoped to Gitea-compatible/authenticated hosts so GitHub, GitLab, Bitbucket and Azure DevOps repositories can coexist in the same VS Code workspace without being surfaced as Gitea repositories.
- The Activity Bar container uses a standalone Gitea Pull Request identity instead of reusing the legacy container state.
- The Activity Bar icon represents a pull-request workflow.

### Compatibility

- The existing full PR detail panel remains available as a secondary view.
- Existing PR, Issue and CI operations are intentionally preserved during the incremental migration.

## [0.1.0] - 2026-08-16

### Added

- Standalone **Gitea Pull Request** product identity and transformation roadmap.
- Pull-request workspace/session state foundation with VS Code context-key synchronization.
- Baseline tests for PR session state transitions.
- Reproducible Make-based development workflow for clean builds, validation, VSIX packaging and local installation.
- Canonical disposable local package output under `.artifacts/vsix/`.

### Changed

- CI uses the same Make-based clean build/test/package path as local development.
- CI build runtime moves to Node.js 22 to match the pinned `@vscode/vsce` packaging tool.

## Project origin

**Gitea Pull Request** started from an earlier Gitea VS Code extension codebase and a short-lived enhanced fork maintained by zheddhe. The standalone product line begins at `0.1.0`; releases from the predecessor/fork are intentionally not reproduced in this changelog because they belong to a different product/version history and their old release links are not canonical for this repository.

The inherited MIT-licensed code remains attributed through the repository license/copyright history. Any contribution back to the predecessor project should be prepared independently from the historical fork baseline rather than from the standalone `0.x` product line.
