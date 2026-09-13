# Gitea Pull Request 1.1.0 — Release preparation

This document is the working release gate for `1.1.0`. It is intentionally initialized before the release is complete so each Phase 10 story can update the same source of truth.

## Release intent

`1.1.0` is an incremental post-1.0 release focused on three areas:

1. review continuity and native inline ergonomics;
2. contextual access to the right detail surface, especially CI diagnostics from review;
3. stronger protection against local-only or divergent source-branch work during merge and cleanup.

The package version remains `1.0.0` until all Phase 10 stories are integrated and the release gate is satisfied.

## Story status

| Story | Scope | Status |
| --- | --- | --- |
| #58 / 10.1 | Review continuity and native inline ergonomics | Implemented and E2E validated in PR #61 |
| #59 / 10.2 | Contextual action cleanup and review-to-CI navigation | Planned before release |
| #60 / 10.3 | Source-branch divergence safety before merge and cleanup | Planned before release |

## 10.1 validated behavior

- New review comments can be created directly from the native authoritative PR diff.
- Canonical anchors cover context, added, removed and deterministically mapped unchanged lines outside raw-diff hunks.
- Pending review state propagates immediately in both directions between Inline Review and PR Detail.
- Unresolved and Pending have independent navigation cycles backed by one shared logical cursor.
- Navigation controls disappear when a cycle contains fewer than two navigable targets.
- Pending navigation is visually distinct from unresolved-conversation navigation in the native editor title.
- Historical review conversations are presented as Outdated instead of being reattached to unsafe current-diff positions.
- Outdated and Resolved remain independent states.
- Submitted pending items reconcile back to persisted conversation state only when the successor is deterministic.
- Unplaceable/outdated logical conversations remain accessible from PR Detail while native navigation skips unsafe projections.

## Remaining release scope

### 10.2 — #59

- Remove the legacy Issue-row Add Comment action while retaining full Issue Detail commenting.
- Expose contextual job/log inspection from PR checks in Review Pull Request.
- Reuse existing CI / Actions state, detail surfaces and adaptive refresh rather than introducing a second CI implementation.

### 10.3 — #60

- Introduce one normalized source-branch synchronization diagnostic shared by merge and cleanup.
- Warn when local-only commits are absent from the server-side PR before merge.
- Distinguish behind, ahead, diverged and unverifiable states using Git graph/reachability semantics.
- Protect destructive post-merge cleanup when local-only work remains.
- Never automatically push, reset, rebase or discard local work as part of these safeguards.

## Documentation gate

Before `1.1.0` is tagged:

- [x] Initialize `CHANGELOG.md` with an Unreleased `1.1.0` section.
- [x] Add Phase 10 / `1.1.0` to `docs/ROADMAP.md`.
- [x] Document 10.1 review-continuity behavior and E2E validation.
- [ ] Integrate 10.2 release notes and user-facing behavior.
- [ ] Integrate 10.3 release notes and safety behavior.
- [ ] Review README screenshots/text if the final 1.1 UI materially changes documented workflows.
- [ ] Replace `Unreleased` with the final release date.
- [ ] Bump `package.json` / lockfile version to `1.1.0` only at the release-candidate stage.

## Validation gate

Before release:

- [ ] All three Phase 10 stories merged.
- [ ] CI green on the final release candidate.
- [ ] `make verify` succeeds.
- [ ] Install and validate the exact generated VSIX with `make reinstall-vsix`.
- [ ] E2E review continuity: create/reply/resolve/reopen, Pending/Unresolved navigation, outdated behavior and submit/reconcile continuity.
- [ ] E2E review-to-CI navigation from PR checks.
- [ ] E2E merge warning for local-ahead/diverged source branches.
- [ ] E2E post-merge cleanup protection for local-only commits.
- [ ] No regression in Reviewed/Viewed state, merge readiness, Issue Detail, Actions or conflict-resolution workflow.

## Release procedure

Once the gate is complete, follow [`RELEASING.md`](RELEASING.md): finalize version metadata and changelog date, verify the VSIX, merge the release candidate, tag the merged commit, publish the GitHub Release and upload that same verified VSIX to the Visual Studio Marketplace.
