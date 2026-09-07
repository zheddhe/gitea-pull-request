# Phase 9.2-A — Adaptive polling foundation

## Scope

9.2-A introduces the domain policy and centralized scheduler foundation only.
It does not migrate existing views, change user-visible refresh behavior, or mutate the Git working tree.

## Architecture

```text
feature / VS Code signals
        |
        v
   PollingContext
        |
        v
adaptivePollingDecision()   <- pure policy
        |
        v
   PollingScheduler         <- one central timer
        |
        v
 registered resource.run()
```

## Resource contract

Each polling resource has:

- a unique stable key;
- a pure context supplier describing visibility, window activity, lifecycle and user activity;
- an asynchronous `run()` callback;
- a result indicating whether remote data changed.

The scheduler owns timing state (`unchangedCount`, `inFlight`, `nextRunAt`). Features do not own polling timers.

## Policy inputs

The initial policy distinguishes:

- resource kind;
- VS Code window active/inactive;
- resource visible/hidden;
- idle/recent-action/editing activity;
- active/terminal/creation/post-merge lifecycle;
- consecutive unchanged polls;
- in-flight state.

## Initial cadence

| State | Base cadence |
| --- | ---: |
| Visible CI logs | 2 s |
| Visible CI job | 5 s |
| Visible CI runs / PR readiness | 10 s |
| Visible active PR | 15 s |
| Visible issues | 60 s |
| Inactive VS Code window | 2 min |
| Terminal / post-merge | 5 min |

Hidden resources use a 4x multiplier. Consecutive unchanged results use a bounded `1x -> 2x -> 4x` backoff. A recent user action temporarily selects a 2 s cadence for active resources. Editing pauses automatic polling.

These values are deliberately policy constants in 9.2-A; later slices may tune them from validation data without changing scheduler mechanics.

## Scheduler invariants

1. There is at most one scheduler timer regardless of the number of registered resources.
2. Resource keys are unique; duplicate registration is rejected.
3. A resource can never execute concurrently with itself (single-flight).
4. `changed: true` resets backoff; `changed: false` increments bounded policy backoff state.
5. `accelerate()` resets backoff and makes the resource immediately due.
6. Disposing a registration prevents future runs and ignores completion scheduling for a disposed in-flight resource.
7. Disposing the scheduler clears the central timer and all registrations.
8. The scheduler has no VS Code dependency and uses an injectable clock, allowing deterministic unit tests.
9. Poll callbacks are data refresh operations only. They must not checkout, merge, fetch Git refs into the working tree, modify files, or otherwise mutate Git state implicitly.

## Deferred to 9.2-B+

- VS Code window focus/visibility signal adapters;
- Webview and TreeView registration lifecycle;
- pending-review/editing signal integration;
- migration of `visibilityRefreshPolicy`;
- migration of CI, PR, issue and live-log refresh paths;
- cross-feature API request coalescing beyond scheduler resource-key single-flight;
- telemetry/diagnostic instrumentation and cadence tuning.
