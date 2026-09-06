# Phase 9.2 — Runtime UX hardening

Runtime validation after the centralized polling migration exposed four follow-up requirements that remain part of Phase 9.2 before merge.

## CI rerun/cancel latency

A rerun/cancel acknowledgement can arrive before Gitea exposes the new queued/active run. A single `accelerate()` is therefore insufficient: an early response containing only the previous terminal run could return the resource to terminal cadence.

Decision:

- active/queued CI is a `pending` polling lifecycle;
- visible pending CI polls every 5 seconds with no unchanged backoff;
- rerun/cancel opens a short burst window (up to roughly one minute) that keeps the CI resource in the pending cadence until the new run appears;
- once the run is terminal and the burst is exhausted, normal terminal cadence applies.

## Pull Request readiness while checks are pending

Readiness refresh is non-destructive with respect to the Review Pull Request draft body. It therefore must not be paused merely because a pending review is being edited.

Decision:

- pending checks use the `pending` lifecycle;
- visible readiness polls every 5 seconds with no unchanged backoff while checks are pending;
- readiness polling continues during review editing;
- the broad active-PR snapshot remains edit-sensitive and may pause to avoid disruptive session/view refreshes.

## Pull Request Detail freshness

Current behavior is manual: PR Detail refreshes when opened/reopened, after mutations initiated by the panel, or when its explicit refresh action is used. It does not currently inherit comments/replies/resolve actions performed from the native comparison/review surface.

A naïve timer around `PRDetailPanel.update()` is not acceptable because `update()` rebuilds the Webview HTML and could destroy local title/body/comment/reply text that has not yet been committed.

Target design:

- add a dedicated centralized `pull-request-detail` resource;
- fingerprint PR metadata, discussion/reviews and native review conversations;
- auto-refresh only when the panel is safe to rebuild;
- expose local Webview dirty/editing state to the resource and pause while an unsaved editor is active;
- accelerate when native review conversation state changes;
- keep the explicit refresh action as a permanent escape hatch.

## Sticky PR Detail navigation

The PR Detail tab strip is currently part of the scrolling document, so navigation and the refresh action can disappear on long diffs.

Target UX:

- make the PR Detail tab/navigation bar sticky;
- keep Refresh and Open in Browser available in that sticky chrome;
- keep the four tab titles visible while scrolling long content.

## Review History sort

The separate `Sort` select consumes vertical space and separates the control from the tab it affects.

Target UX:

- remove the standalone select;
- put a compact ascending/descending control directly next to `Review History (n)` in the tab chrome;
- down arrow = newest first (descending);
- up arrow = oldest first (ascending);
- persist the selected order in Webview state across tab switches/refreshes.
