# Changelog

All notable changes to **Gitea Pull Request** are documented in this file.

## 0.8.0 - Unreleased

### Added
- CI / Actions rows now surface the completed run conclusion as the primary signal, with event/date metadata and branch/commit detail retained in the tooltip.
- **Assigned to Me** issue aggregation follows the current Open/Closed filter and supports both single- and multi-assignee Gitea payloads.
- Native VS Code log levels (`trace`, `debug`, `info`, `warn`, `error`) through a `LogOutputChannel`, with the existing `log()` helper retained as an `info()` compatibility alias.

### Changed
- Pull-request and issue rows are flattened into leaf business objects; secondary metadata and Markdown description/body content are consolidated into safe hover tooltips.
- Common PR/Issue actions are available inline with consistent semantics: **View Details**, **Open in Browser**, and **Activate PR** where applicable.
- Pull-request aggregation icons are semantic: pull-request for **All Open**, eye/review for **Waiting for my review**, and person for **Created by me**.
- Closed issues use a red status signal instead of purple to avoid merged-state ambiguity.

### Fixed
- Removed a sidebar-specific hard-coded folder icon that overrode the intended **Waiting for my review** category icon.
- Completed CI runs no longer present generic `completed` as their meaningful final result.
- Missing CI metadata is omitted rather than displayed as `undefined`.

## 0.7.0 - 2026-08-17

### Added
- Native **View Details**, **Open in Browser**, **Refresh** and lifecycle title actions across the active pull-request workspace.
- PR Detail tabs for **Inline Reviews**, **Review History**, **Discussion** and **Commits**, including persisted active-tab state across refreshes.
- Inline review comment reconstruction on diff lines, review-history association for submitted inline messages, and chronological review ordering.
- Inline editing for PR and Issue titles, descriptions and discussion comments.
- Create Pull Request metadata selection for reviewers, assignees, labels and milestone through native QuickPick workflows.
- Explicit Source/Base branch identification and branch management in Create and Review workflows.
- PR-centric Checks presentation with external target links and diagnostics for Gitea commit-status normalization.
- Marketplace release workflow using GitHub OIDC trusted publishing with no stored Marketplace PAT.
- `NOTICE` documenting the MIT-licensed project origin and independent maintenance line.

### Changed
- Review Pull Request is organized around **Branch identification → Review → Checks → Merge readiness → Actions**.
- PR Detail is focused on inspection, discussion and inline review; merge/close/checkout operations live in the contextual Review panel.
- Issue Detail is simplified to a single Markdown-oriented detail surface with compact title actions.
- Create Pull Request uses a **General information** block, Source/Base terminology, empty title by default and native metadata pickers.
- Obsolete legacy PR creation flow removed.
- Create-mode temporary view IDs preserve the user's normal Pull Requests / Issues / CI layout memory.
- CI and release builds now use **Node.js 24**.
- Extension compatibility baseline raised to **VS Code 1.133.0+** and the extension-host test runner now executes against VS Code `1.133.0` by default.
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
- Release CI validates tag/package version, publisher and package identity before publishing the exact generated VSIX to GitHub Releases and the Visual Studio Marketplace.
- Release publication uses pinned `@vscode/vsce 3.9.2` with GitHub OIDC trusted publishing.

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
