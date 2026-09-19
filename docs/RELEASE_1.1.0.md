# Gitea Pull Request 1.1.0 — Release record

`1.1.0` is the first incremental release after the 1.0 UX baseline. It focuses on review continuity, contextual diagnostics and stronger safeguards around merge and source-branch cleanup.

## Release scope

The release completes Phase 10 and includes the final corrective pass required before publication.

| Story | Scope | Status |
| --- | --- | --- |
| #58 / 10.1 | Review continuity and native inline ergonomics | Completed |
| #59 / 10.2 | Contextual action cleanup and review-to-CI navigation | Completed |
| #60 / 10.3 | Source-branch divergence safety before merge and cleanup | Completed |
| #63 / 10.4 | Conflict-resolution eligibility bugfix | Completed |
| #64 / 10.5 | Direct contextual CI job routing bugfix | Completed |

## Delivered behavior

### Review continuity

- New review comments can be created directly from the authoritative native PR diff.
- Canonical anchors cover context, added, removed and deterministically mapped unchanged lines outside raw-diff hunks.
- Pending review state propagates immediately between Inline Review and PR Detail.
- Unresolved conversations and pending review operations have independent Previous/Next cycles backed by one shared logical cursor.
- Navigation controls disappear when a cycle contains fewer than two navigable targets.
- Historical conversations are presented as Outdated instead of being attached to an unsafe current-diff position.
- Outdated and Resolved remain independent lifecycle dimensions.
- Submitted pending items reconcile back to persisted conversation state only when the successor is deterministic.

### Contextual CI access

- PR checks in Review Pull Request can open the existing CI job/log surface directly.
- The contextual workflow reuses the same CI / Actions provider and adaptive refresh path.
- Job-specific Gitea check URLs preserve both run and job identity.
- A known job opens directly; a picker is used only for a genuinely ambiguous multi-job run.

### Merge and cleanup safety

- One normalized source-branch synchronization model is shared by merge and cleanup workflows.
- Local/remote state can be classified as in-sync, behind, ahead, diverged or unknown where safely resolvable.
- Local-only commits trigger an explicit advisory before a server-side merge.
- The server-side PR head remains authoritative for what Gitea will merge.
- No merge warning path silently pushes, resets or rebases local work.
- Post-merge cleanup re-discovers branch state before destructive actions.
- Local or remote branches containing unique or unverifiable work are kept rather than presented as safe to delete.
- Verified forced local deletion is reserved for cases where analysis proves that no local-only work remains, including squash/rebase cleanup scenarios.

### Final bugfix pass

- WIP / Draft PRs no longer trigger false conflict-resolution guidance merely because Gitea reports `mergeable=false`.
- Approval, check, permission and no-content blockers are not treated as technical Git conflicts.
- Manual and automatic conflict-resolution entry points use the same eligibility rule.
- Job-specific PR check actions no longer ask the user to select the already-known job again.

## Documentation status

The 1.1.0 release candidate keeps the following sources aligned:

- `README.md` — current user-facing product behavior.
- `CHANGELOG.md` — public release history and 1.1.0 notes.
- `ROADMAP.md` — completed Phase 10 milestone and future direction.
- `RELEASING.md` — version-independent release procedure.
- `TESTING.md` — current test architecture and release validation guidance.
- `AUTHENTICATION.md` — current PAT and multi-instance guidance.
- `CONTRIBUTING.md` — current development baseline.

## Release gate

Immediately before tagging, validate the promoted release candidate under Node.js 24:

```bash
make verify
make reinstall-vsix
```

Confirm that the installed artifact is:

```text
.artifacts/vsix/gitea-pull-request-1.1.0.vsix
```

The final smoke pass should cover:

- native review create/reply/resolve/reopen;
- unresolved and pending navigation;
- outdated conversation presentation;
- contextual PR-check → CI job/log navigation;
- WIP/non-conflict PRs not offering conflict-resolution preparation;
- genuine technical conflicts still offering the conflict workflow;
- pre-merge local-ahead warning;
- post-merge protection for committed-but-unpushed local work;
- normal safe cleanup for synchronized branches;
- Issue Detail commenting and current Issue row actions;
- CI / Actions tree run/job/log behavior.

## Publication sequence

After the release candidate is validated:

1. merge the release PR into `main`;
2. tag the merged commit as `v1.1.0`;
3. let `.github/workflows/release.yml` rebuild and verify the exact tagged source;
4. confirm the versioned VSIX is attached to the draft GitHub Release;
5. review the release notes and publish the draft;
6. upload that same verified VSIX to the Visual Studio Marketplace.

The operational procedure remains documented in [`RELEASING.md`](RELEASING.md).
