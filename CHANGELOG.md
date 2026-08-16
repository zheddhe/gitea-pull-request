# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the standalone product line follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - Unreleased

### Added

- Native **Refresh Active Pull Request** title action in **Changes in Pull Request**, reusing the existing safe explicit refresh/rebind path.

### Changed

- **Changes in Pull Request** and **Review Pull Request** now use a consistent native title-action order: Refresh first, Close active PR second.
- Phase 6 keeps PR refresh explicit and event-driven rather than reintroducing polling.

## [0.6.0] - 2026-08-17

### Added

- Dedicated **Gitea Pull Request** Activity Bar container for the active pull-request lifecycle.
- Separate monochrome Activity Bar icons for the general Gitea workspace and the contextual pull-request workspace.
- Contribution tests covering container membership, contextual visibility conditions, workspace labels and distinct icon assets.

### Changed

- The general **Gitea** Activity Bar workspace contains Pull Requests, Create Pull Request, Issues and CI / Actions.
- **Changes in Pull Request**, **Review Pull Request** and **Pull Request Merged** live in the dedicated contextual pull-request workspace.
- Activating a pull request automatically focuses the contextual Gitea Pull Request container after the active session is established.
- The existing general-container contribution identity is retained to reduce VS Code layout-state disruption during the topology split.
- Repository groups plus **All Open** and **Waiting for my review** expand by default on first entry into the Gitea workspace.
- Phase 6 now owns the broader visual/ergonomic polish, Changes-view refresh title action, PR-centric CI refinement, notifications, Markdown and accessibility work.

### Validation

Interactive Phase 5 validation confirmed that the dual-container structure and both Activity Bar icons match the intended workflow and remain visually distinguishable alongside GitHub Pull Requests.

Validation also covered active-to-merged visibility, local/remote cleanup, cleanup completion returning the contextual workspace to idle, create placement, and mixed GitHub/Gitea coexistence.

## [0.5.0] - 2026-08-16

### Added

- Dedicated **Pull Request #N Merged** post-merge sidebar WebviewView driven by the `merged` pull-request session state.
- Automatic focus of the post-merge view after a successful sidebar merge.
- `BranchCleanupService` for resolving and safely cleaning the actual local and remote head/base branch identities.
- Independent local/remote branch cleanup selection, including local aliases that track a differently named remote PR branch.
- Safe checkout of the target/base branch before deleting a currently checked-out local head branch.
- Remote branch deletion using the resolved remote + PR head identity rather than the local branch name.
- Post-merge lifecycle actions: **Create New Pull Request...**, **Delete Branch...**, **Checkout '<base>' without deleting branch**, **Keep branches and finish**, and branch-state refresh.
- **Mark Ready for Review** in the contextual review view for Gitea draft/WIP pull requests.
- Tests covering branch identity, cleanup planning/execution, checkout-before-delete ordering, partial failure, WIP readiness distinction and ready-for-review title normalization.

### Changed

- The post-merge workflow no longer ends with the Phase 3 Changes/Review views simply disappearing: the `merged` session now has an explicit sidebar successor state.
- Local and remote cleanup choices are selected independently and are both preselected when both branches exist, matching the expected GitHub Pull Requests cleanup ergonomics.
- Remote branch discovery uses Git refs directly so branches such as `origin/gitea/test` are not missed by VS Code Git API ref-shape differences.
- Merge-readiness presentation distinguishes **Draft / WIP**, **No changes to merge**, and **Not mergeable (Gitea)** instead of presenting every `mergeable=false` signal as a conflict-style blocker.
- A WIP/no-delta PR no longer receives an additional misleading generic Gitea server-side mergeability reason when its explicit blocker already explains why merge is unavailable.
- Refreshing an active PR now rebinds and reloads the existing **Changes in Pull Request** provider when the PR head SHA/title/refs change, so newly pushed commits update the contextual diff instead of leaving stale zero-diff content.
- Phase 4 cleanup decisions are based on resolved Git identities rather than assuming the PR head name, local branch name and remote branch name are identical.

### Validation

Interactive Phase 4 validation covered transition to the dedicated post-merge view, exact merged context, local + remote cleanup, independent cleanup selection, actual deletion of `origin/gitea/test`, Create New Pull Request including WIP recreation, and inherited no-diff/WIP/conflict readiness behavior.

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
