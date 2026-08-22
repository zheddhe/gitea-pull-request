# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

## 0.8.0 - Unreleased

`0.8.0` completes the core pull-request workflow introduced in the previous releases and focuses on making day-to-day use safer, clearer and more natural inside VS Code.

### Added
- **Guided conflict resolution** for pull requests that cannot be merged automatically. The extension prepares the correct local Git state, validates the exact PR head, fetches the relevant remotes, and then hands real conflicts to the native VS Code Source Control / Merge Editor workflow.
- **Abort Merge** support and recovery of an already prepared conflict-resolution session after VS Code reload.
- **Assigned to Me** issue aggregation that follows the current Open/Closed scope.
- Native VS Code diagnostic levels (`trace`, `debug`, `info`, `warn`, `error`) with consistent component-prefixed logging, making troubleshooting easier without flooding normal usage.

### Improved
- **Activity Bar clarity**: pull-request and issue entries are flatter, easier to scan, and expose common actions directly on the row. Secondary metadata remains available in safe Markdown tooltips instead of nested technical children.
- **More meaningful status signals**: completed CI runs display their actual result rather than the generic `completed` state, PR categories use semantic icons, and closed issues use a distinct red signal rather than a merged-like color.
- **Conflict guidance is CI-aware**: the extension avoids prompting for conflict resolution while a real CI check is still pending, then resumes normal mergeability guidance once checks settle.
- **Safer refresh behavior**: returning to the contextual PR workspace refreshes sufficiently stale remote PR/CI state at a natural visibility boundary, without background polling.
- **Draft preservation**: Create Pull Request and Review Pull Request keep unsent text, selections and form state when switching Activity Bar context. Fresh remote state can be loaded without discarding an in-progress review draft.
- **Post-merge workflow** is more compact and explicit, with three equally valid choices: **✓ Checkout Base / Delete Source**, **Checkout Base / Keep Source**, and **Create New Pull Request**. Cleanup remains recommended without being presented as an error or destructive warning.

### Fixed
- Refresh no longer acts as an accidental save step before switching away from editable Create/Review views.
- Non-mergeable pull requests no longer leave the user at a dead end with no guided path toward native conflict resolution.
- Conflict notifications no longer race an explicitly pending CI check while Gitea is still determining mergeability.
- Completed CI runs no longer expose `completed` as if it were the meaningful final result, and unavailable metadata is no longer rendered as `undefined`.
- The **Waiting for my review** category no longer falls back to a generic folder icon.
- Post-merge actions no longer rely on stacked full-width or destructive-looking controls.

### Quality and maintainability
- Test coverage now has a reproducible function/branch baseline for directly testable domain logic. It is intentionally informational rather than a percentage release gate, so it can highlight regressions and uncovered decision paths without driving artificial tests.
- Logging semantics are documented and normalized across components, with stable prefixes and native VS Code log-level filtering.

### Release preparation
- Promote package and lock metadata to `0.8.0` **before merge** with `make promote RELEASE_VERSION=0.8.0` so the merged commit tagged `v0.8.0` already matches the release version.
- Run `make verify` and `make reinstall-vsix`, then validate `.artifacts/vsix/gitea-pull-request-0.8.0.vsix` before marking the release PR ready.
- After merge, tag `v0.8.0` and publish the GitHub Release. Release CI rebuilds and attaches the verified VSIX.
- Publish to the Visual Studio Marketplace manually by uploading that exact GitHub Release VSIX from the publisher management page.

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
- Gitea `1.26.4` is the minimum documented/tested server baseline for `0.7.0`; older Gitea versions are not claimed as supported.
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
- Dual-container topology separating general Gitea browsing from active PR context.
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
