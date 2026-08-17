# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the standalone product line follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - Unreleased

### Added

- Native **View Details**, **Open in Browser**, **Refresh** and lifecycle title actions across the active PR workspace where native VS Code actions improve discoverability.
- Explicit Create-mode view profile with isolated IDs so the temporary Create layout cannot overwrite the user's normal Pull Requests / Issues / CI layout memory.
- Create branch refresh that reloads newly published branches while preserving draft fields, metadata and still-valid Source/Base selections.
- PR-centric **Checks** presentation in Review Pull Request with combined status, individual checks, descriptions and normalized external links.
- Native Issues Open/Closed filter using TreeView + QuickPick.
- Rich Markdown rendering for Issue and PR descriptions/comments through VS Code's Markdown renderer with explicit HTTP(S) link routing.
- PR Detail **Inline Reviews** surface with submitted inline comments reconstructed on their diff lines from Gitea review-comment data.
- PR Detail **Review History** with chronological sorting and associated inline review messages when available.
- Inline editing of PR/Issue titles, descriptions and discussion comments.
- GitHub Actions OIDC trusted publishing workflow for Marketplace releases, with tag/package/publisher identity validation and no stored Marketplace PAT.
- `NOTICE` documenting the MIT-licensed upstream origin and the independent product line.

### Changed

- **Create Pull Request** now uses Source/Base branch terminology, a dedicated **General information** block, native QuickPick metadata selection with compact selected-value presentation, and no branch-derived default title.
- The obsolete legacy PR creation wizard/command has been removed.
- **Review Pull Request** is organized around Branch identification → Review → Checks → Merge readiness → Actions and owns operational review/branch/merge actions.
- Top-level PR comments are owned by PR Detail instead of being duplicated in the sidebar Review panel.
- PR Detail is focused on inspection, discussion and inline review; branch management and merge/close actions have moved to Review Pull Request.
- PR Detail preserves the active tab across explicit refreshes.
- Issue Detail is simplified to one Markdown detail surface without the low-value History tab or duplicated Close/Re-open controls.
- Issue Tree keeps **View Details** as the first child and uses native filter/navigation affordances.
- **Pull Request Merged** uses native Refresh → Close title actions while destructive branch cleanup remains explicit in the Webview.
- Create / Review / Post-merge / PR Detail / Issue Detail share a consistent action hierarchy, section treatment, focus styling and VS Code theme typography.
- General CI / Actions remains in the main Gitea workspace; PR-specific checks stay contextual to Review Pull Request.
- Phase 6 keeps refresh explicit and bounded; no polling/refresh loop was reintroduced.
- Release automation now uses Node.js 22, the Make-based clean build/package gate, pinned `@vscode/vsce 3.9.2`, and the exact generated VSIX for both GitHub Release and Marketplace publication.

### Fixed

- Relative Gitea check target URLs are normalized before opening.
- Gitea commit-status state normalization accepts canonical/fallback state fields and logs raw/normalized check values for diagnostics.
- Inline review comments are fetched from Gitea's per-review comments endpoint and normalized from Gitea response positions so historical comments can be placed back into the diff.
- Development dependency installation explicitly includes dev dependencies and restores the required `@typescript-eslint/eslint-plugin` dependency.
- Redundant body-level Cancel / Refresh / Keep branches actions superseded by native title actions have been removed.
- Webview HTML escaping and CSP/event-handler cleanup removes lint/security regressions encountered during the polish pass.

### Documentation / release preparation

- README and ROADMAP now describe the final Phase 6 UX rather than intermediate legacy workflows.
- Visual Studio Marketplace publisher identity is `zheddhe` (displayed as Rémy Canal) and the extension remains an independently maintained personal open-source project.
- MIT attribution for inherited code is preserved; Rémy Canal's copyright notice is added for the independently maintained product line and subsequent contributions.
- Marketplace release steps and OIDC trusted-publishing requirements are documented in `docs/RELEASING.md`.

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

- **Changes in Pull Request** is driven by the active PR session during the incremental migration.
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
- Reproducible Make-based development workflow for clean builds, validation, packaging and local installation.
- Canonical disposable local package output under `.artifacts/vsix/`.

### Changed

- CI uses the same Make-based clean build/test/package path as local development.
- CI build runtime moves to Node.js 22 to match the pinned `@vscode/vsce` packaging tool.

## Project origin

**Gitea Pull Request** started from an earlier Gitea VS Code extension codebase and a short-lived enhanced fork maintained by zheddhe. The standalone product line begins at `0.1.0`; releases from the predecessor/fork are intentionally not reproduced in this changelog because they belong to a different product/version history and their old release links are not canonical for this repository.

The inherited MIT-licensed code remains attributed through the repository license/copyright history. Any contribution back to the predecessor project should be prepared independently from the historical fork baseline rather than from the standalone `0.x` product line.
