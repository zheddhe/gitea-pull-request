# Changelog

All notable changes to **Gitea Pull Request** are documented here from the standalone product line onward.

## 1.0.0 - 2026-09-08

`1.0.0` is the first full user-experience baseline: native review interaction, adaptive refresh, reliable Actions detail and multi-instance authentication designed for least privilege.

### Added

- Native VS Code review conversation actions for Reply, Resolve and Reopen, integrated with the existing pending-review transaction instead of bypassing it.
- Centralized adaptive polling for PR state, CI / Actions and Issues, with visibility/focus-aware cadence, bounded backoff and editing-safe pauses.
- Reliable Actions execution detail and artifact handling where supported by Gitea APIs.
- Multi-instance account management from the status bar, including per-instance sign-in, PAT replacement, sign-out and repository re-scan recovery.
- Deterministic repository-to-Gitea-instance mapping across HTTPS, SSH, SCP-style remotes, custom SSH ports and OpenSSH aliases.
- Optional `gitea.servers[].transports` mappings for installations where Git transport and web/API endpoints use different hosts or ports.
- Authentication diagnostics showing the active instance, PAT authentication method and observed runtime capabilities without exposing credentials.
- Capability observation for identity, repository, Issues and Actions, with independent `verified`, `denied`, `unsupported` and `unknown` states.

### Improved

- Authentication and authorization are now distinct: `401` identifies invalid/revoked authentication while `403` identifies insufficient effective permission.
- Permission failures degrade only the affected capability; unrelated extension functions remain available.
- PAT credentials are isolated by canonical Gitea instance identity and stored only in VS Code SecretStorage.
- Existing credentials are migrated to canonical instance keys without forcing users to re-authenticate.
- Repository discovery no longer assumes that an unknown Git hostname is a Gitea server and never sends a PAT to probe an unmapped host.
- The status bar is reduced to the transversal Gitea account state; repository re-scan is available through account management / Command Palette instead of occupying persistent UI space.
- API error messages are normalized and sanitized consistently across PR review and metadata APIs.
- PAT onboarding now recommends least-privilege scopes instead of broad `all` / unnecessary `misc` access.

### Least-privilege PAT guidance

For the complete workflow:

- `read:user`
- `write:repository`
- `write:issue`

For read-only use:

- `read:user`
- `read:repository`
- `read:issue`

Token scopes allow access to API families; they do not elevate the underlying Gitea user's repository permissions.

### Compatibility

- VS Code 1.133.0 or later
- Gitea 1.26.4 minimum supported compatibility floor, with capability-gated fallbacks where newer APIs are unavailable
- Gitea 1.27.x or later recommended for the complete review experience, including inline Reply and the newest review capabilities
- Gitea Runner 3.x.x or later recommended for the current Actions / CI experience
- Node.js 24.x build / CI baseline

Gitea 1.26.4 remains supported, but 1.27.x+ is the preferred server baseline for the full 1.0 UX. Unsupported operations degrade independently so unrelated PR, Issue and Actions capabilities remain available where the server exposes them.

OAuth2 Authorization Code + PKCE is intentionally deferred beyond the 1.0 acceptance gate; PAT remains first-class for arbitrary self-hosted Gitea deployments.

## 0.9.0 - 2026-08-31

`0.9.0` established persistent interactive review and first-class Issue authoring.

### Highlights

- Persistent Reviewed/Viewed progress with selective invalidation when newer PR heads change reviewed files.
- Interactive inline review conversations with reply grouping, resolve/reopen lifecycle and capability gating.
- Persistent pending-review transactions with safe retry after partial failure.
- Explicit bridge between authoritative PR review snapshots and local working-tree editing.
- First-class Create Issue sidebar workflow with repository selection, Markdown editing, assignees, labels and milestones.
- `.gitea/ISSUE_TEMPLATE/` discovery with conservative front-matter support and Blank issue fallback.
- Improved Gitea 1.26 raw-diff and no-status-check behavior.

## 0.8.0 - 2026-08-24

- Guided merge-conflict preparation using native Git and VS Code Source Control / Merge Editor.
- Clearer Activity Bar actions and effective review-state signaling.
- Assigned-to-me Issue aggregation.
- CI run/job actions including individual job re-run where supported.
- Safer visibility-driven refresh and editable-view draft preservation.
- Compact post-merge checkout / cleanup workflow.

## 0.7.0 - 2026-08-17

- Native detail/browser/refresh actions across PR and Issue workflows.
- PR Detail tabs for Inline Reviews, Review History, Discussion and Commits.
- Inline title/description/comment editing.
- Create Pull Request reviewer/assignee/label/milestone metadata.
- PR-centric Checks presentation and diagnostics.
- Node.js 24 build/CI and VS Code 1.133.0 compatibility baseline.

## 0.6.0 - 2026-08-16

- Dedicated **Gitea Pull Request** Activity Bar workspace for the active PR lifecycle.
- General Gitea browsing separated from contextual PR review/merge state.

## 0.5.0 - 2026-08-16

- Post-merge lifecycle and explicit local/remote branch cleanup.
- Checkout-base, keep-source and follow-up PR paths.

## 0.4.0 - 2026-08-16

- Sidebar-first review and merge workflow.
- Review readiness, merge-method selection and review actions.

## 0.3.0 - 2026-08-16

- Sidebar-first pull-request creation workflow.

## 0.2.0 - 2026-08-16

- Explicit active pull-request session model.

## 0.1.0 - 2026-08-16

- Standalone **Gitea Pull Request** product/version line and initial architecture split.
