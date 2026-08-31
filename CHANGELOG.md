# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

## 0.9.0 - Unreleased

`0.9.0` strengthens the two most important day-to-day workflows: interactive pull-request review and first-class Issue authoring directly from the sidebar.

### Added
- **Persistent Reviewed/Viewed file progress** in Changes in Pull Request, including directory/section propagation, aggregate progress and selective invalidation when a newer PR head changes a previously reviewed file.
- **Interactive inline review conversations** with root/reply grouping, same-anchor reconstruction, capability-gated replies, resolve/reopen lifecycle and compact resolved-thread presentation.
- A persistent **pending review session** for inline comments, replies and conversation lifecycle operations. Pending work survives refresh, submits as one user-level transaction and retains failed operations for retry after partial server failure.
- Explicit **Open Working File**, **Checkout Source and Open File** and **Open Editable PR Diff** paths that connect review context to local development without silently changing branches or blurring review/edit authority.
- A dedicated **Create Issue** sidebar authoring workspace that keeps the Issues tree visible while Pull Requests and CI / Actions are compacted.
- Repository-aware Issue title and Markdown description authoring with draft preservation across Activity Bar navigation and safe refreshes.
- `.gitea/ISSUE_TEMPLATE/` discovery from the selected repository's default branch, including conservative front-matter support for `name`, `about`, `title`, `labels` and `assignees`, plus explicit **Blank issue** fallback.
- Native VS Code QuickPick selection for Issue **assignees, labels and milestone**, aligned with Create Pull Request interaction conventions.

### Improved
- **Merge Readiness refresh stays neutral** while checks, reviews and mergeability inputs are still consolidating, so partial remote state is not presented as a final conclusion.
- PR review and local modification now have an explicit authority boundary: the PR snapshot remains authoritative for review/comments, while the working tree remains authoritative for edits/tests.
- Inline conversations follow Gitea's effective grouping semantics even when explicit reply linkage is missing from returned comments.
- Resolved conversations collapse as one thread by default while explicit expansion state survives normal refresh.
- PR Detail interaction density is more consistent across Inline Reviews, Review History, Discussion and Commits, with metadata/actions kept close to the objects they affect.
- The pending review toolbar stays hidden when empty and becomes a compact **Submit review changes (N)** / **Discard pending** control only when needed.
- Create Issue uses the same metadata-card interaction language as Create Pull Request and replaces the legacy title-only prompt as the primary authoring path.
- Issue template values act as editable seeds rather than locked defaults. Refresh preserves user edits, explicit template changes intentionally reseed the form, and repository switches retain portable title/body while clearing repository-bound selections.
- Project metadata and arbitrary branch-derived Issue defaults remain intentionally absent while reliable read/write semantics cannot be represented truthfully.

### Fixed
- Gitea 1.26 raw pull-request diff retrieval now uses the authenticated REST endpoint `/api/v1/repos/{owner}/{repo}/pulls/{index}.diff` rather than the web route.
- Repositories with **zero reported status checks** now show `Checks: none` instead of being treated as artificially pending; branch protection that explicitly requires checks still blocks when none are reported.
- Issue creation progress now ends when the Gitea POST completes instead of remaining active while the success notification waits for user interaction.

### Compatibility notes
- The established minimum supported/tested Gitea baseline remains **1.26.4**.
- Full Reply + Resolve/Reopen interaction has been validated against **Gitea 1.27.2**.
- Reply and Resolve/Reopen remain capability-gated so older supported servers keep the rest of the review experience without exposing unsupported actions.

### Quality and release preparation
- Creation-state, layout, metadata submission, template parsing/discovery, draft reconciliation and Issue regression contracts are covered by automated tests.
- Existing Issue Detail, inline row actions, Assigned to Me aggregation and Open/Closed filtering remain protected by regression coverage.
- `package.json` and `package-lock.json` are promoted together to **0.9.0**.
- Final release gate: `make verify`, `make reinstall-vsix`, validate `.artifacts/vsix/gitea-pull-request-0.9.0.vsix`, then merge/tag/publish and upload that exact verified VSIX to the Marketplace.

## 0.8.0 - 2026-08-24

`0.8.0` completes the core pull-request workflow introduced in the previous releases and focuses on making day-to-day use safer, clearer and more natural inside VS Code.

### Added
- **Guided conflict resolution** for pull requests that cannot be merged automatically. The extension prepares the correct local Git state, validates the exact PR head, fetches the relevant remotes, and then hands real conflicts to the native VS Code Source Control / Merge Editor workflow.
- **Abort Merge** support and recovery of an already prepared conflict-resolution session after VS Code reload.
- **Assigned to Me** issue aggregation that follows the current Open/Closed scope.
- **Individual CI job re-run** where supported by Gitea, without conflating it with workflow-level cancellation.
- Native VS Code diagnostic levels (`trace`, `debug`, `info`, `warn`, `error`) with consistent component-prefixed logging, making troubleshooting easier without flooding normal usage.

### Improved
- **Activity Bar clarity**: pull-request and issue entries are flatter, easier to scan, and expose common actions directly on the row. Secondary metadata remains available in safe Markdown tooltips instead of nested technical children.
- **Inline action consistency**: PR, Issue and CI business operations no longer depend on secondary right-click menus. PR rows keep only safe workflow entry points, Issues expose their useful operations directly, and CI actions are scoped to run/job level and current state.
- **More meaningful status signals**: completed CI runs display their actual result rather than the generic `completed` state, PR categories use semantic icons, and closed issues use a distinct red signal rather than a merged-like color.
- **Review-state consistency**: Changes in Pull Request now uses the same effective latest-review semantics as Merge Readiness, and refreshes its review cache after review actions so its signal follows Approve / Request Changes without reloading the diff.
- **CI job log detail** now follows the same compact detail-view language as PR and Issue detail: status signal and badge, concise run/job/runner metadata, title actions for Refresh and Browser, and the existing aggregated execution log.
- **Conflict guidance is CI-aware**: the extension avoids prompting for conflict resolution while a real CI check is still pending, then resumes normal mergeability guidance once checks settle.
- **Safer refresh behavior**: returning to the contextual PR workspace refreshes sufficiently stale remote PR/CI state at a natural visibility boundary, without background polling.
- **Draft preservation**: Create Pull Request and Review Pull Request keep unsent text, selections and form state when switching Activity Bar context. Fresh remote state can be loaded without discarding an in-progress review draft.
- **Post-merge workflow** is more compact and explicit, with three equally valid choices: **✓ Checkout Base / Delete Source**, **Checkout Base / Keep Source**, and **Create New Pull Request**. Cleanup remains recommended without being presented as an error or destructive warning.

### Fixed
- Refresh no longer acts as an accidental save step before switching away from editable Create/Review views.
- A newer `REQUEST_CHANGES` review no longer leaves Changes in Pull Request green because of an older approval from the same reviewer.
- Review actions no longer leave the Changes in Pull Request review signal stale until an unrelated manual refresh.
- Non-mergeable pull requests no longer leave the user at a dead end with no guided path toward native conflict resolution.
- Conflict notifications no longer race an explicitly pending CI check while Gitea is still determining mergeability.
- Completed CI runs no longer expose `completed` as if it were the meaningful final result, and unavailable metadata is no longer rendered as `undefined`.
- The **Waiting for my review** category no longer falls back to a generic folder icon.
- Post-merge actions no longer rely on stacked full-width or destructive-looking controls.

### Quality and maintainability
- Test coverage now has a reproducible function/branch baseline for directly testable domain logic. It is intentionally informational rather than a percentage release gate, so it can highlight regressions and uncovered decision paths without driving artificial tests.
- Logging semantics are documented and normalized across components, with stable prefixes and native VS Code log-level filtering.
- Contribution and presentation tests protect effective review-state semantics, inline-only action ownership, state-aware CI actions and the Job Logs detail contract.

## 0.7.0 - 2026-08-17

### Added
- Native **View Details**, **Open in Browser**, **Refresh** and lifecycle title actions across the active pull-request workspace.
- PR Detail tabs for **Inline Reviews**, **Review History**, **Discussion** and **Commits**, including persisted active-tab state across refreshes.
- Inline review comment reconstruction on diff lines, review-history association for submitted inline messages, and chronological review ordering.
- Inline editing for PR and Issue titles, descriptions and discussion comments.
- Create Pull Request metadata selection for reviewers, assignees, labels and milestone through native QuickPick workflows.
- Explicit Source/Base branch identification and branch management in Create and Review workflows.
- PR-centric Checks presentation with external target links and diagnostics for Gitea commit-status normalization.
- `NOTICE` documenting the MIT-licensed project origin and independent maintenance line.

### Changed
- Review Pull Request is organized around **Branch identification → Review → Checks → Merge readiness → Actions**.
- PR Detail is focused on inspection, discussion and inline review; merge/close/checkout operations live in the contextual Review panel.
- Issue Detail is simplified to a single Markdown-oriented detail surface with compact title actions.
- Create Pull Request uses a **General information** block, Source/Base terminology, empty title by default and native metadata pickers.
- Obsolete legacy PR creation flow removed.
- Create-mode temporary view IDs preserve the user's normal Pull Requests / Issues / CI layout memory.
- CI and release builds use **Node.js 24**.
- Extension compatibility baseline raised to **VS Code 1.133.0+** and the extension-host test runner executes against VS Code `1.133.0` by default.
- Gitea `1.26.4` is the minimum documented/tested server baseline for `0.7.0`; older Gitea releases are not claimed as supported.
- Development typings aligned to the latest published VS Code typings available during release preparation (`@types/vscode ^1.125.0`), with Node typings moved to the 24.x line and `@vscode/test-electron` moved to the 3.x line.

### Fixed
- Native PR refresh rebinds the active session and diff to the fresh head SHA without polling.
- Create branch refresh preserves unsaved draft fields and metadata while reconciling branch selections.
- Gitea inline review comments are loaded from the correct review-scoped endpoints and normalized to the positions used by the diff renderer.
- Commit-status parsing accepts normalized Gitea state/status representations and logs raw values for diagnostics.
- Duplicate body controls superseded by native title actions were removed.
- ESLint dependency/install consistency restored for clean `npm ci` / Make-based builds.

### Release preparation
- Marketplace publisher: **Rémy Canal (`zheddhe`)**.
- Marketplace extension identity: **`zheddhe.gitea-pull-request`**.
- MIT attribution preserved and extended for the independently maintained product line.

## 0.6.0 - 2026-08-16

### Added
- Dedicated **Gitea Pull Request** Activity Bar workspace for the active pull-request lifecycle.
- Dual-container topology separating general Gitea browsing from the active PR lifecycle.
- Contextual **Changes in Pull Request**, **Review Pull Request** and post-merge views.

### Changed
- Create mode uses focused temporary view contributions without replacing the historical standard view IDs.
- Pull Requests / Issues / CI remain in the main Gitea workspace while active review operations move to the contextual workspace.

## 0.5.0 - 2026-08-16

### Added
- Post-merge lifecycle and explicit local/remote branch cleanup.
- Checkout-base and keep-branches completion paths.

## 0.4.0 - 2026-08-16

### Added
- Sidebar-first review and merge workflow.
- Review readiness, merge-method selection and review actions.

## 0.3.0 - 2026-08-16

### Added
- Sidebar-first pull-request creation workflow.

## 0.2.0 - 2026-08-16

### Added
- Explicit active pull-request session model.

## 0.1.0 - 2026-08-16

### Added
- Standalone Gitea Pull Request product/version line and initial architecture split.
