# Gitea Pull Request — Transformation Roadmap

## Product direction

The extension is evolving from an earlier Gitea VS Code codebase into an independent product named **Gitea Pull Request**, published by **zheddhe**.

The target user experience is sidebar-first and inspired by the workflow ergonomics of GitHub Pull Requests for VS Code, while remaining implemented specifically for Gitea and its REST API.

The standalone product/version line begins at `0.1.0`. Predecessor/fork releases are historical implementation context rather than part of this roadmap's release sequence; inherited MIT attribution remains preserved by the repository license/history.

## Design principles

1. **Sidebar first** — common pull-request operations should be completed from the Activity Bar without requiring the detail panel.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`; use WebviewView only when richer form controls are required.
3. **State driven** — UI visibility and actions are derived from an explicit pull-request workspace/session state.
4. **API/UI separation** — Gitea REST concerns stay isolated from UI providers and commands.
5. **Progressive migration** — preserve working functionality while replacing PR orchestration incrementally.
6. **Details where useful** — richer detail views complement the sidebar for Markdown, discussion history and inline review context.

## Versioning during the transformation

| Transformation milestone | Product version |
|---|---:|
| Phase 0 — Product split and foundation | `0.1.0` |
| Phase 1 — Active pull-request model | `0.2.0` |
| Phase 2 — Sidebar-first PR creation | `0.3.0` |
| Phase 3 — Sidebar-first review and merge | `0.4.0` |
| Phase 4 — Post-merge branch lifecycle | `0.5.0` |
| Phase 5 — Dedicated Pull Request workspace | `0.6.0` |
| Phase 6 — Secondary workflows and polish | `0.7.0` |

Patch versions (`0.x.1`, `0.x.2`, …) are reserved for corrections that do not introduce the next roadmap phase.

### Phase completion / release gate

Before a phase PR is marked ready for merge, review together implementation/tests, package + lock version metadata, changelog, README, roadmap/Story acceptance criteria, `make verify`, and local VSIX validation.

Promote only when the complete phase is ready:

```bash
make promote RELEASE_VERSION=<target-version>
```

The promotion target updates `package.json` and `package-lock.json` together and deliberately does not create a Git tag.

## Target workflow state model

```text
idle
  -> creating
  -> active/open
  -> reviewing
  -> merged
  -> cleanup
  -> idle
```

`active/open` and `reviewing` share the same underlying active session state with contextual capabilities.

---

## Phase 0 — Product split and foundation

**Release:** `0.1.0`

Completed: standalone product/version line, licensing preservation, state foundations, stable identifiers, reproducible Make-based build/test/package/install workflow.

---

## Phase 1 — Active pull-request model

**Release:** `0.2.0`

Completed: active PR session, contextual Changes view, explicit activation/clear, repository invalidation, mixed-forge isolation, standalone Activity Bar identity.

---

## Phase 2 — Sidebar-first PR creation

**Release:** `0.3.0`

Completed: dedicated sidebar creation, repo/base/head selection, title/body, supported metadata, normal + WIP/draft creation, safe create lifecycle and tests. Projects remain intentionally omitted while reliable API read/write support is unavailable.

---

## Phase 3 — Sidebar-first review and merge

**Release:** `0.4.0`

Completed: contextual review view, comment/approve/request-changes, review-state presentation, readiness from CI/reviews/policy/mergeability, merge-method selection, checkout base, real merge, stable zero-diff handling, refresh-loop fixes and merged-session transition.

### Follow-up robustness carried into Phase 4

Phase 4 development exposed additional Phase 3 edge cases and completed them without creating a separate patch release:

- `mergeable=false` from Gitea is shown as a server-side blocker only when WIP/no-delta does not already explain the blocked state;
- WIP/draft PRs are shown explicitly as **Draft / WIP** and can be switched to **Ready for Review** from the sidebar by removing Gitea's WIP title marker;
- the active PR Refresh path rebinds/reloads the contextual diff when the head SHA changes, so additional pushed commits replace stale cached diff state;
- exact conflicting-file details are not fabricated when the supported Gitea API does not expose them reliably.

---

## Phase 4 — Post-merge branch lifecycle

**Release:** `0.5.0`

Completed: explicit merged-state view, exact repository/branch identity discovery, safe local/remote cleanup, checkout-before-delete, independent remote deletion, Create New Pull Request, checkout-without-delete, keep-branches completion and cleanup safety tests.

Interactive validation confirmed local + remote deletion, actual remote ref removal, default dual selection, WIP recreation, post-merge completion and coherent return to idle.

---

## Phase 5 — Dedicated Pull Request workspace

**Release:** `0.6.0`

Completed: stable dual-container topology separating general Gitea browsing from the active PR lifecycle.

### Delivered

- General **Gitea** Activity Bar container contains Pull Requests, Create Pull Request, Issues and CI / Actions.
- Dedicated **Gitea Pull Request** Activity Bar container contains Changes in Pull Request, Review Pull Request and Pull Request Merged.
- Contextual container uses a distinct monochrome review-oriented icon and coexists visually with the official GitHub Pull Requests extension.
- Activating a PR focuses the contextual pull-request container.
- Active/merged visibility remains driven by session context keys.
- Post-merge cleanup remains entirely in the contextual container and the merged view disappears once cleanup completes.
- Repository groups plus **All Open** and **Waiting for my review** expand by default on first entry.
- General CI / Actions intentionally stays in the main Gitea workspace.

Interactive Phase 5 validation covered the dual-container grouping/icons, active PR navigation, merge transition, cleanup completion and mixed GitHub/Gitea coexistence. The phase was released as `0.6.0` on 2026-08-17.

---

## Phase 6 — Secondary workflows and polish

**Release target:** `0.7.0`

### Goal

Complete the product around the stabilized dual-container PR workflow and perform the dedicated UX/ergonomic refinement pass without changing the Phase 5 navigation topology.

### Implemented

#### Native lifecycle/navigation actions

- Changes in Pull Request and Review Pull Request expose consistent native **View Details → Open in Browser → Refresh → Close** title actions.
- Create Pull Request exposes native branch **Refresh → Close** actions.
- Pull Request Merged exposes native branch-state **Refresh → Close** actions; destructive cleanup remains explicit in the Webview.
- Redundant body-level lifecycle/navigation controls were removed where native title actions replaced them.
- PR activation now opens the contextual workspace and PR Detail together.

#### Create Pull Request

- Temporary create-mode view IDs isolate focused Create sizing from the user's persistent normal Pull Requests / Issues / CI layout.
- Branch refresh reloads newly published branches without losing the in-progress title, description or metadata selections.
- Branch identification uses consistent **Source branch / Base branch** terminology.
- **General information** groups explicit PR title and description; the title starts empty instead of using a branch-derived default.
- Reviewers, assignees and labels remain native multi-select QuickPick workflows and selected values are reflected as chips; milestone remains single-select.
- The obsolete legacy PR creation flow/command was removed.

#### Review Pull Request

- Sidebar Review is focused on **Branch identification → Review → Checks → Merge readiness → Actions**.
- Source/base branch context is presented together; base can be changed and both branches can be checked out explicitly.
- Review decisions are limited to **Approve** and **Request Changes**; top-level comments are kept in PR Detail Discussion.
- PR-centric checks show status summary, description and safe external target links while general CI remains in the Gitea workspace.
- Merge readiness combines available PR state, review state, CI and branch-policy signals without fabricating unsupported conflict detail.
- Final Actions contain repository-supported merge method, **Merge PR** and **Close PR**.

#### PR Detail

- Detail header/status presentation is aligned with Issue Detail and retains inline title editing plus compact browser/refresh icons.
- Tabs are **Inline Reviews**, **Review History**, **Discussion** and **Commits**; the active tab is preserved across refresh renders.
- Inline Reviews reconstruct existing Gitea inline comments onto diff lines using review comment positions, with unplaced fallback when the referenced line is absent.
- Review History displays chronological review events and related inline comment bodies, with Oldest/Newest ordering.
- Discussion uses Markdown rendering for PR description and comments, with inline editing for title, description and top-level comments.
- Merge/checkout/close/review-decision actions were removed from PR Detail so action ownership remains in the contextual Review view.
- File status/readability and dark-theme diff presentation were normalized.

#### Issues

- Native Open/Closed filter is exposed through TreeView + QuickPick.
- Issue Tree keeps **View Details** as the first issue child and avoids showing the raw issue body as a tree row.
- Issue Detail is simplified to a single surface without the low-value History tab.
- Issue title, description and comments support inline editing.
- Description/comments use VS Code Markdown rendering with safe HTTP(S) link handling.
- Browser/Refresh stay as compact title icons; Close/Re-open remain issue workflow commands.
- Activity feed/notifications, saved queries and broader search were reviewed and intentionally deferred because they do not currently justify added persistent UI/state complexity.

#### Accessibility, diagnostics and regression coverage

- TreeView and QuickPick workflows retain native keyboard behavior.
- Webview primary controls remain keyboard-native with focus-visible treatment and labels/ARIA where needed.
- Tests cover create-mode topology/layout isolation, native title actions, draft synchronization, checks, issue filtering, Markdown/CSP, PR detail tabs/history/comments and keyboard interaction markers.
- Diagnostic logging covers inline-review API aggregation/positions and raw/normalized commit check states.
- Development dependency installation is deterministic for clean lint/test/VSIX builds.

### Interactive validation completed

Phase 6 interactive validation has covered:

- Changes/Create/Review/Post-merge title actions and duplicate-control cleanup;
- Create branch refresh with a branch published after the form opened;
- preservation of Create draft fields/metadata and restoration of the standard Gitea layout;
- PR-centric checks and external check links;
- Issues Open/Closed filtering and Markdown detail rendering;
- PR/Issue detail layout, inline editing and comment workflows;
- inline PR review comments reconstructed on their diff lines;
- review history presentation and chronological sorting;
- branch management/review/check/readiness/action organization;
- mixed Gitea/GitHub coexistence.

### Phase 6 compatibility baseline

For the `0.7.0` release line:

- **VS Code 1.133.0+** is the declared minimum and extension-host tests default to VS Code `1.133.0`;
- **Gitea 1.26.4+** is the documented baseline; `1.26.4` is the server version used for functional validation and older releases are not claimed as supported;
- **Node.js 24.x** is the development, dependency-installation, CI, packaging and release baseline.

The published `@types/vscode` package currently lags the VS Code product release; compilation therefore uses the latest available `^1.125.0` typings while runtime tests target the actual VS Code `1.133.0` baseline.

### Phase 6 release gate remaining

Version metadata is already promoted to `0.7.0`. The final dependency baseline changed after promotion, so `package-lock.json` must be regenerated under Node.js 24 and committed before validation.

Final gate:

```bash
node --version
npm --version
npm install --package-lock-only
npm ci --include=dev
make verify
make reinstall-vsix
```

Then:

1. review the regenerated `package-lock.json` and confirm package/lock remain at `0.7.0`;
2. confirm the rebuilt artifact is `.artifacts/vsix/gitea-pull-request-0.7.0.vsix`;
3. perform the final smoke pass on Create, active PR refresh/detail/review, Issues detail and post-merge lifecycle;
4. verify Marketplace trusted publishing;
5. mark Story #14's release-gate acceptance criterion complete;
6. mark PR #16 ready for review/merge only after the gate is green;
7. after merge, tag `v0.7.0`, publish the GitHub Release and let release CI publish the exact VSIX to the Marketplace.

---

## Current code disposition

| Current area | Direction |
|---|---|
| `src/api/` | Keep and evolve |
| `src/auth/` | Keep |
| `src/context/` | Keep; integrate PR session state |
| `src/views/pullRequestProvider.ts` | Keep and evolve |
| `src/views/prDiffProvider.ts` | Keep and evolve; active-PR driven with explicit reload semantics |
| `src/views/prDetailPanel.ts` | Keep as rich PR inspection/discussion/inline-review view |
| `src/views/issuesProvider.ts` | Keep |
| `src/views/issueDetailPanel.ts` | Keep as rich Markdown issue detail/editing view |
| `src/views/ciRunsProvider.ts` | Keep in general Gitea workspace; PR-centric status remains contextual in Review |
| `src/commands/prCommands.ts` | Continue splitting by workflow responsibility when useful |
| `src/extension.ts` | Continue evolving toward composition/bootstrap rather than workflow coordination |

## Testing strategy

Each phase adds tests at the lowest stable layer first: domain/session unit tests, pure planning tests, API contract-style tests, command/Git orchestration tests, presentation/source-contract tests and extension-host tests where practical. Destructive cleanup safety/error-path coverage remains a release requirement rather than deferred polish.

Minimum regression workflows:

1. authenticate and discover repository;
2. list PRs;
3. activate/refresh PR, open detail and native diff;
4. create normal or WIP/draft PR, including metadata and branch refresh;
5. approve/request changes and submit inline review comments;
6. inspect PR checks/readiness and merge with supported methods while blocking no-delta/WIP/server-non-mergeable states appropriately;
7. inspect/filter/edit issues and comments;
8. post-merge branch identity, checkout and cleanup;
9. switch repository while a PR is active;
10. coexist with GitHub Pull Requests using the dual Gitea workspace topology.

## Migration rule

A phase is complete only when its new workflow is functional, its documentation/version metadata is coherent, the old behavior it replaces can be removed without losing a supported capability, and the phase release gate has passed. The project should remain buildable and usable at every phase boundary.
