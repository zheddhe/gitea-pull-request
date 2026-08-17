# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the standalone product line follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - Unreleased

### Added

- Native title actions for active PR **View Details**, **Open in Browser**, **Refresh** and contextual Close in **Changes in Pull Request** and **Review Pull Request**.
- Native **Refresh** and **Close** title actions for **Create Pull Request** and **Pull Request Merged**.
- Dedicated temporary Create-mode view IDs so VS Code keeps the focused creation layout separate from the user's normal Pull Requests / Issues / CI proportions.
- Explicit Create branch refresh that reloads Gitea branches while preserving title, description, reviewers, assignees, labels, milestone and still-valid source/base selections.
- PR-centric **Checks** section in Review Pull Request with success/pending/failure/warning summary, descriptions and safe external check links.
- Native Open/Closed Issues filter using TreeView + QuickPick.
- Rich Issue Detail Markdown rendering using VS Code's Markdown renderer, with safe fallback and explicit HTTP(S) link handling.
- Inline editing for Issue title, description and comments.
- Rich PR Detail tabs for **Inline Reviews**, **Review History**, **Discussion** and **Commits**.
- Inline review comment reconstruction on diff lines from Gitea review-comment position data, with an `Unplaced inline comments` fallback when a referenced line is no longer present.
- Review History aggregation of global review events and their associated inline comment messages, with Oldest/Newest ordering.
- Inline editing for PR title, description and top-level Discussion comments.
- Active PR Detail tab persistence across refresh renders.
- Branch-management controls in Review Pull Request for source/base visibility, base-branch update and explicit checkout actions for both branches.
- Structured diagnostic logging for Gitea inline-review comment retrieval/placement and normalized PR check status values.
- Regression/source coverage for title-action ordering, create-mode layout isolation, Create draft preservation, PR checks, issue filtering, Markdown rendering/CSP, keyboard-native controls, PR detail presentation, inline comments and comment editing.

### Changed

- Create, Review and Post-merge Webviews now share a more consistent section hierarchy, action hierarchy, spacing, focus treatment and VS Code theme-token styling.
- **Create Pull Request** now presents **Source branch** and **Base branch** consistently with Review Pull Request, uses a **General information** block, starts with an explicit empty PR title rather than deriving one from the branch name, and reflects selected metadata as compact chips while retaining native QuickPick selection.
- The obsolete legacy PR creation command/flow has been removed.
- **Review Pull Request** is now focused on branch management, review decisions, checks, merge readiness and final actions; top-level PR comments remain in PR Detail rather than being duplicated in the sidebar.
- Review Pull Request section order follows the user workflow: Branch identification → Review → Checks → Merge readiness → Actions.
- Merge readiness presentation is condensed into PR/mergeability state plus a secondary review/CI summary while preserving explicit blockers and warnings.
- **Pull Request Merged** keeps destructive branch cleanup explicit in the Webview, while non-destructive branch-state refresh and finish/keep-branches lifecycle actions use native title actions.
- Activating a PR now opens the contextual Gitea Pull Request workspace and PR Detail together.
- **Changes in Pull Request** keeps View Details/Open Browser in native title actions and orders branch/commits/reviews/files as contextual data.
- PR Detail focuses on inspection, discussion and inline review work; merge/checkout/close/review-decision actions are owned by the contextual Review view.
- Issue Detail is simplified to a single detail surface without the low-value History tab; browser/refresh are title icons and close/re-open remain issue workflow commands.
- Issue children keep **View Details** first and no longer expose the raw issue body as a tree child.
- PR and Issue detail presentation now uses aligned status dots/badges, title typography, Markdown cards and comment styling.
- PR refresh remains explicit and event-driven rather than reintroducing polling.
- General CI / Actions remains in the main Gitea container; only PR-centric readiness/check context is duplicated into the Review workflow.
- Activity feed/notifications, saved queries and broader issue search remain intentionally deferred after Phase 6 scope review because they do not currently justify additional persistent UI/state complexity.

### Fixed

- Relative Gitea check `target_url` values are normalized before opening instead of being rejected as unsupported URLs.
- Gitea inline review comments are retrieved from the correct per-review endpoint and normalized from `position` / `original_position` response fields before diff placement.
- Existing inline review comments no longer disappear after submission; they are reloaded and placed back under the corresponding diff line where possible.
- File-status markers and readable foreground colors are restored in PR Detail diff/file lists for dark themes.
- Removed duplicate Webview body actions that were superseded by native title actions.
- Create-mode view sizing no longer overwrites the user's standard Gitea workspace layout memory.
- Development dependency installation is explicit and `@typescript-eslint/eslint-plugin` is restored so clean `npm ci` / lint / VSIX rebuilds work reliably.
- Commit-status normalization now tolerates alternate/raw status value shape and logs raw vs normalized values for CI diagnosis.

### Validation

Interactive Phase 6 validation covered native refresh/close actions, branch refresh with a newly published branch, preservation of Create draft metadata, exact restoration of the standard Gitea view layout, cleaned Create/Review/Post-merge actions, PR-centric checks and external links, Issue filtering, Markdown rendering, rich PR/Issue detail ergonomics, inline review comment placement/history, comment editing and mixed Gitea/GitHub coexistence.

The final `0.7.0` gate remains: promote `package.json` + `package-lock.json`, run `make verify`, rebuild/reinstall the VSIX and complete the final smoke pass before marking the Phase 6 PR ready.

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
- Phase 6 owns the broader visual/ergonomic polish, Changes-view refresh title action, PR-centric CI refinement, issue/Markdown secondary workflows and accessibility work.

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
