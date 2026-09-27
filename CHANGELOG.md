# Changelog

All notable changes to **Gitea Pull Request** are documented here from the standalone product line onward.

## 1.1.1 - 2026-09-27

`1.1.1` is a corrective release focused on complete and reliable pull-request data for large or long-lived PRs.

- Fetch all paginated changed files instead of only the first Gitea API page.
- Restore complete `Changes in Pull Request` trees, file counts and Reviewed/Viewed denominators on large PRs.
- Keep reviewed-file reconciliation and file-derived additions/deletions aligned with the full changed-file collection.
- Fetch all paginated PR commits so commit history and aggregate commit information are no longer truncated.
- Fetch all paginated PR reviews in both the shared API client and the dedicated review workflow path.
- Ensure effective review state and review history are based on the complete server-side review collection.
- Preserve Gitea response order without deduplication or reordering.
- Fail the complete request if a later page fails instead of exposing a known-partial collection as complete.
- Add regression coverage for multi-page files, commits and reviews, single-page PRs, missing pagination headers and later-page failures.
- Compatibility baseline unchanged from 1.1.0.

## 1.1.0 - 2026-09-19

`1.1.0` strengthens review continuity, contextual CI navigation and merge/cleanup safety while polishing the post-1.0 workflow.

- Add native `Add Review Comment` directly from authoritative PR diffs, with canonical anchors for context, added, removed and deterministically mapped unchanged lines.
- Keep pending review state synchronized between Inline Review and PR Detail.
- Add independent Previous/Next navigation for unresolved conversations and pending review operations, backed by one shared logical cursor.
- Present historical conversations as Outdated when they can no longer be mapped safely to the current diff.
- Keep Outdated and Resolved as independent conversation lifecycle dimensions.
- Open CI jobs and logs directly from PR checks while reusing the existing CI / Actions provider and refresh path.
- Preserve known run/job identity from Gitea check URLs and skip redundant job selection when the target job is already known.
- Classify source-branch synchronization as in-sync, behind, ahead, diverged or unknown where safely resolvable.
- Warn before merge when committed local work is not pushed, without silently pushing, resetting or rebasing.
- Revalidate branch state before post-merge cleanup and preserve local or remote branches when unique work cannot be ruled out.
- Restrict verified forced local deletion to cases where analysis proves no local-only work remains, including squash/rebase cleanup scenarios.
- Stop treating WIP / Draft, approval, checks, permissions or no-content states as technical Git conflicts.
- Share one conflict-resolution eligibility rule between automatic and manual entry points.
- Simplify Issue row actions while keeping Issue Detail as the canonical commenting and discussion surface.
- Compatibility baseline: VS Code 1.133.0+, Gitea 1.26.4+ with 1.27.x+ recommended for the complete review experience, Node.js 24.x build / CI baseline.

## 1.0.0 - 2026-09-08

`1.0.0` is the first full user-experience baseline: native review interaction, adaptive refresh, reliable Actions detail and multi-instance authentication designed for least privilege.

- Add native VS Code review conversation actions for Reply, Resolve and Reopen, integrated with the persistent pending-review transaction.
- Centralize adaptive polling for PR state, CI / Actions and Issues with visibility/focus-aware cadence, bounded backoff and editing-safe pauses.
- Add reliable Actions execution detail and artifact handling where supported by Gitea APIs.
- Add multi-instance account management from the status bar, including per-instance sign-in, PAT replacement, sign-out and repository re-scan recovery.
- Resolve repositories deterministically across HTTPS, SSH, SCP-style remotes, custom SSH ports and OpenSSH aliases.
- Support explicit `gitea.servers[].transports` mappings when Git transport and Gitea web/API endpoints intentionally differ.
- Add authentication diagnostics for active instance, PAT method and observed runtime capabilities without exposing credentials.
- Track identity, repository, Issues and Actions capabilities independently as verified, denied, unsupported or unknown.
- Distinguish authentication failures (`401`) from authorization failures (`403`) and degrade only the affected capability.
- Isolate PAT credentials by canonical Gitea instance identity in VS Code SecretStorage and migrate existing credentials without forced re-authentication.
- Avoid probing unknown Git hosts with Gitea credentials and keep foreign or ambiguous forges unmapped.
- Reduce the status bar to transversal Gitea account state and move repository re-scan to account management / Command Palette.
- Normalize and sanitize API errors consistently across PR review and metadata APIs.
- Recommend least-privilege PAT scopes for complete and read-only workflows instead of broad `all` / unnecessary `misc` access.
- Compatibility baseline: VS Code 1.133.0+, Gitea 1.26.4+ with 1.27.x+ recommended for the complete review experience, Gitea Runner 3.x+ recommended, Node.js 24.x build / CI baseline.
- OAuth2 Authorization Code + PKCE remains deferred beyond the 1.0 acceptance gate; PAT remains first-class for arbitrary self-hosted Gitea deployments.
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
