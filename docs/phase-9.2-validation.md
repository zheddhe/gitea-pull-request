# Phase 9.2 — Adaptive polling validation

## Runtime coverage validated

- Active pull request registration is created for the current PR session.
- Unchanged active PR polling backs off from 15s to 30s and beyond.
- Pending review editing pauses PR/review-sensitive polling without pausing CI or Issues.
- CI polling runs only for repositories whose CI data has been loaded.
- Terminal CI runs move to the stable lifecycle cadence and back off further while unchanged.
- Gitea unavailability during CI polling produces warnings without destroying the scheduler.
- Issues polling runs for loaded repositories and remains active while a review draft is being edited.
- Live Logs no longer use a local setInterval; scheduler registrations own recurring refresh.
- CI rerun/cancel actions no longer schedule delayed refresh timers and instead accelerate the central CI registration.
- Pull-request readiness has its own scheduler resource for combined checks and reviews.
- Legacy Review-view visibility refresh policy is retired and can no longer initiate network refreshes.

## Expected debug resources

```text
[polling] registered key=<repo>::pr:<number> resource=pull-request ...
[polling] registered key=<repo>::pr:<number>::readiness:<headSha> resource=pull-request-readiness ...
[polling] registered key=ci-runs:loaded-repositories resource=ci-runs ...
[polling] registered key=issues:loaded-repositories resource=issues ...
[polling] registered key=ci-logs:<repo>:<jobId> resource=ci-logs ...
```

## Invariants

- A single extension-wide scheduler owns recurring polling deadlines.
- A resource never runs concurrently with itself.
- Polling does not mutate the Git working tree.
- User editing/pending review state is not lost or interrupted by refresh.
- Resource-specific lifecycle remains distinct from global PR lifecycle.
- Polling failures do not terminate future scheduling.
