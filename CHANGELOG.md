# Changelog

All notable changes to **Gitea Pull Request** are documented here from the standalone product line onward.

## 1.1.0 - 2026-09-19

`1.1.0` strengthens review continuity, contextual CI navigation and merge/cleanup safety while polishing the post-1.0 workflow.

### Highlights

- **Native review continuity**
  - Add review comments directly from authoritative `gitea-pr` diffs.
  - Keep Inline Review and PR Detail synchronized through the shared pending-review transaction.
  - Navigate unresolved conversations and pending review operations independently.
  - Preserve outdated conversations without projecting them onto unsafe current-diff positions.

- **Contextual CI diagnostics**
  - Open CI jobs and logs directly from PR checks in Review Pull Request.
  - Open a known job directly instead of asking the user to select it again.
  - Reuse the existing CI / Actions projection and adaptive polling path.

- **Safer merge and branch cleanup**
  - Classify source-branch synchronization as in-sync, behind, ahead, diverged or unknown when safely resolvable.
  - Warn before merge when committed local work is not part of the authoritative remote PR head.
  - Revalidate branch safety immediately before post-merge cleanup.
  - Keep local or remote branches when unique work cannot be proven safe to delete.

### Added

- **Inline review authoring**
  - Native `Add Review Comment` from authoritative PR diffs.
  - Canonical old/new anchors for context, added, removed and deterministically mapped unchanged lines outside raw-diff hunks.

- **Review navigation**
  - Independent Previous/Next cycles for unresolved conversations and pending review operations.
  - One shared logical cursor across Inline Review and PR Detail.
  - Distinct native navigation affordances for unresolved conversations and pending modifications.

- **Review lifecycle visibility**
  - Explicit Outdated conversation presentation in PR Detail.
  - Historical review threads remain accessible without unsafe reattachment to the current diff.

- **Branch synchronization diagnostics**
  - Shared pre-merge and post-merge source-branch analysis based on Git graph semantics.
  - Explicit local-ahead/diverged advisories before server-side merge.
  - Reachability-aware cleanup decisions for local and remote source branches.

### Improved

- **Review continuity**
  - Pending review state propagates immediately between Inline Review and PR Detail.
  - Submission/reconcile preserves navigation continuity when pending items become persisted conversations.
  - Outdated and Resolved remain independent lifecycle dimensions.
  - Navigation controls are hidden when a cycle contains fewer than two navigable items.
  - PR Detail separates Unresolved, Pending and Outdated states more clearly.

- **Contextual CI**
  - Review checks can open the existing CI job/log surface without introducing review-specific CI state.
  - Job-specific Gitea check URLs preserve both run and job identity.
  - Multi-job selection is shown only when the originating check does not identify a specific job.

- **Issue ergonomics**
  - Issue-row actions are simplified; Issue Detail remains the canonical commenting surface.

- **Merge and cleanup safety**
  - Server-side PR head remains authoritative for what Gitea will merge.
  - Local source state is advisory before merge and safety-critical before destructive cleanup.
  - Cleanup re-discovers branch state at action time rather than relying on stale snapshots.
  - Squash/rebase cleanup can use verified forced deletion only after safety analysis proves no local-only work remains.

### Fixed

- WIP / Draft pull requests no longer trigger a false `Prepare Conflict Resolution` workflow merely because Gitea reports `mergeable=false`.
- Approval, CI/check, permission and no-content blockers are no longer misclassified as technical Git conflicts.
- The manual conflict-resolution command now uses the same technical-conflict eligibility rule as automatic guidance.
- Job-specific PR check actions no longer reopen an unnecessary job picker.
- Post-merge cleanup no longer risks silently deleting committed but unpushed local work.
- Unknown or unmappable branch state is never presented as verified safe for destructive cleanup.

### Compatibility

- **VS Code:** 1.133.0 or later
- **Gitea minimum supported:** 1.26.4, with capability-gated fallbacks for unavailable newer APIs
- **Gitea recommended:** 1.27.x or later for the complete review experience
- **Gitea Runner recommended:** 3.x.x or later for the current Actions / CI experience
- **Node.js:** 24.x build / CI baseline
- **VSIX tooling:** `@vscode/vsce` 4.0.0 on the release path

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
