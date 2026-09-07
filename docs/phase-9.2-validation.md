# Phase 9.2 — Adaptive polling validation

## Runtime coverage validated

- Active pull request registration is created for the current PR session.
- Unchanged active PR polling backs off from 15s to 30s and beyond.
- Pending review editing pauses the broad PR snapshot without pausing CI, Issues, or non-destructive readiness polling.
- CI polling runs only for repositories whose CI data has been loaded.
- Terminal CI runs move to the stable lifecycle cadence and back off further while unchanged.
- Gitea unavailability during CI polling produces warnings without destroying the scheduler.
- Issues polling runs for loaded repositories and remains active while a review draft is being edited.
- Live Logs no longer use a local setInterval; scheduler registrations own recurring refresh.
- CI rerun/cancel actions no longer schedule delayed refresh timers and instead accelerate the central CI registration.
- Pull-request readiness has its own scheduler resource for combined checks and reviews.
- Legacy Review-view visibility refresh policy is retired and can no longer initiate network refreshes.

## Live-state cadence

Some remote states are intentionally exempt from unchanged backoff while work is in progress:

- visible CI runs with an active/queued run poll every **5 seconds**;
- rerun/cancel opens a short burst window so an early stale terminal response from Gitea cannot send CI back to the terminal cadence before the new run becomes visible;
- visible Pull Request readiness with pending checks polls every **5 seconds**;
- readiness polling continues during review editing because readiness refresh retains the review draft;
- visible CI live logs poll every **2 seconds** while the job is active.

Once the remote state becomes stable, normal adaptive cadence/backoff resumes.

## Actions presentation and compatibility

Phase 9.2 keeps Actions presentation capability-driven rather than tied to one Gitea/runner version.

For workflow-run identity, the preferred presentation is:

```text
CI (main)    #94 · success · push
```

The resolver uses the richest metadata available from the server:

1. repository workflow metadata (`GET /actions/workflows`) matched by workflow id, full workflow path, or workflow filename;
2. the workflow name embedded in the run payload;
3. the workflow path embedded in recent run payloads;
4. the workflow id / filename;
5. `Run #<number>` only as a final legacy fallback.

This intentionally tolerates older or partially populated Actions payloads. Missing workflow metadata must degrade presentation only; it must not disable polling, jobs, logs, rerun/cancel, or other existing CI behavior.

Job/step presentation follows the same rule: data already returned by the server is rendered, but Phase 9.2 does not assume runner-specific capabilities that are not present. Exploration of newer Gitea runner capabilities, including richer step/job behavior available on recent runners, is deferred to the later Phase 9 capability story and must retain a fallback path when the connected server/runner cannot provide them.

## Expected debug resources

```text
[polling] registered key=<repo>::pr:<number> resource=pull-request ...
[polling] registered key=<repo>::pr:<number>::readiness:<headSha> resource=pull-request-readiness ...
[polling] registered key=ci-runs:loaded-repositories resource=ci-runs ...
[polling] registered key=issues:loaded-repositories resource=issues ...
[polling] registered key=ci-logs:<repo>:<jobId> resource=ci-logs ...
```

For a visible live resource, the expected attempt includes `delayMs=5000 reason=pending-live` for CI runs/readiness and `delayMs=2000` for live logs.

## Manual validation checklist

1. Open a Pull Request with no pending review and observe an active PR polling attempt.
2. Leave the PR unchanged and confirm the broad PR snapshot increments `unchanged` and backs off.
3. Start a review edit and confirm the broad PR snapshot pauses while CI/Issues continue.
4. Keep a check pending and confirm `pull-request-readiness` continues at 5s even during review editing.
5. Rerun a completed workflow/job and confirm `ci-runs` stays on a 5s live cadence until the new run appears and while it remains active.
6. Open a running job's logs and confirm a `ci-logs` registration appears and unregisters after completion.
7. Confirm a recent Gitea server exposing workflow metadata renders workflow identity (for example `CI (main)`) rather than only `Run #N`; verify the legacy fallback remains usable when metadata is absent.
8. Hide/show relevant views and move VS Code in/out of focus to validate adaptive context changes.
9. Temporarily make Gitea unavailable and verify warnings appear without scheduler death or toast spam.

## Invariants

- A single extension-wide scheduler owns recurring polling deadlines.
- A resource never runs concurrently with itself.
- Polling does not mutate the Git working tree.
- User editing/pending review state is not lost or interrupted by refresh.
- Resource-specific lifecycle remains distinct from global PR lifecycle.
- Polling failures do not terminate future scheduling.
- Optional Actions metadata enriches presentation but never becomes a hard dependency for core CI behavior.
