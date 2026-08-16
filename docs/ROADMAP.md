# Gitea Pull Request — Transformation Roadmap

## Product direction

The extension is evolving from an earlier Gitea VS Code codebase into an independent product named **Gitea Pull Request**, published by **zheddhe**.

The target user experience is sidebar-first and inspired by the workflow ergonomics of GitHub Pull Requests for VS Code, while remaining implemented specifically for Gitea and its REST API.

The standalone product/version line begins at `0.1.0`. Predecessor/fork releases are historical implementation context rather than part of this roadmap's release sequence; inherited MIT attribution remains preserved by the repository license/history.

## Design principles

1. **Sidebar first** — common pull-request operations should be completed from the Activity Bar without requiring the full detail panel.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`; use WebviewView only when richer form controls are required.
3. **State driven** — UI visibility and actions are derived from an explicit pull-request workspace/session state.
4. **API/UI separation** — Gitea REST concerns stay isolated from UI providers and commands.
5. **Progressive migration** — preserve working functionality while replacing PR orchestration incrementally.
6. **Full detail remains available** — the existing PR detail experience remains an alternative/secondary view rather than the primary workflow.

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

Completed: dedicated sidebar creation, repo/base/head selection, title/body, Files Changed, supported metadata, normal + WIP/draft creation, safe create lifecycle and tests. Projects remain intentionally omitted while reliable API read/write support is unavailable.

---

## Phase 3 — Sidebar-first review and merge

**Release:** `0.4.0`

Completed: contextual review view, comment/approve/request-changes, review-state presentation, readiness from CI/reviews/policy/mergeability, merge-method selection, checkout base, real merge, stable zero-diff handling, refresh-loop fixes and merged-session transition.

### Follow-up robustness carried into Phase 4

Phase 4 development exposed additional Phase 3 edge cases and completed them without creating a separate patch release:

- `mergeable=false` from Gitea is shown as a server-side blocker only when WIP/no-delta does not already explain the blocked state;
- WIP/draft PRs are shown explicitly as **Draft / WIP** and can be switched to **Ready for Review** from the sidebar by removing Gitea's WIP title marker;
- the active PR Refresh path now rebinds/reloads the contextual diff when the head SHA changes, so additional pushed commits replace stale cached diff state;
- exact conflicting-file details are still not fabricated when the supported Gitea API does not expose them reliably.

---

## Phase 4 — Post-merge branch lifecycle

**Release:** `0.5.0`

Completed: explicit merged-state view, exact repository/branch identity discovery, safe local/remote cleanup, checkout-before-delete, independent remote deletion, Create New Pull Request, checkout-without-delete, keep-branches completion and cleanup safety tests.

Interactive validation confirmed local + remote deletion, actual remote ref removal, default dual selection, WIP recreation, post-merge completion and coherent return to idle.

---

## Phase 5 — Dedicated Pull Request workspace

**Release target:** `0.6.0`

### Goal

Separate general Gitea browsing from the contextual active-PR lifecycle using two distinct Activity Bar containers while preserving the existing sidebar-first workflow.

### Implemented

- General **Gitea** Activity Bar container contains Pull Requests, Create Pull Request, Issues and CI / Actions.
- Dedicated **Gitea Pull Request** Activity Bar container contains Changes in Pull Request, Review Pull Request and Pull Request Merged.
- Contextual container uses a distinct monochrome review-oriented icon and coexists visually with the official GitHub Pull Requests extension.
- Activating a PR focuses the contextual pull-request container.
- Active/merged visibility remains driven by existing session context keys.
- Post-merge cleanup remains entirely in the contextual container and the merged view disappears once cleanup completes.
- On first entry into the Gitea workspace, repository groups plus **All Open** and **Waiting for my review** expand by default so open and assigned/review work is immediately visible.
- Contribution tests cover container membership, labels, context conditions and distinct icon assets.
- General CI / Actions intentionally stays in the main Gitea workspace; PR-centric CI presentation remains Phase 6 polish.

### Interactive validation completed

- both Activity Bar containers render with the intended grouping;
- both icons are distinguishable and coexist correctly with GitHub Pull Requests;
- active PR navigation opens Changes + Review in the contextual container;
- merge transitions to the post-merge context;
- cleanup completes correctly and removes the merged contextual view;
- general Pull Requests / Issues / CI remain in the Gitea workspace.

### Release gate remaining

- final documentation review;
- `make verify` on final Phase 5 code;
- promote atomically with:

```bash
make promote RELEASE_VERSION=0.6.0
```

- run `make verify` again after promotion;
- run `make reinstall-vsix` and final smoke validation;
- mark the Phase 5 PR ready and merge.

---

## Phase 6 — Secondary workflows and polish

**Release target:** `0.7.0`

### Goal

Complete the product around the stabilized dual-container PR workflow and perform the dedicated UX/ergonomic refinement pass.

### Work

- Native refresh action/icon in the **Changes in Pull Request** view title, reusing explicit safe refresh semantics.
- Visual/interaction consistency across Create Pull Request, Review Pull Request and post-merge views.
- PR-centric CI/check presentation while general CI / Actions remains in the Gitea workspace.
- Notifications/activity feed if useful.
- Richer issue integration without requiring GitHub-specific branch-from-issue behavior.
- Advanced filtering/search/saved queries if useful.
- Markdown rendering.
- Accessibility/keyboarding review.
- Broader command/API integration tests and Marketplace packaging/documentation.

---

## Current code disposition

| Current area | Direction |
|---|---|
| `src/api/` | Keep and evolve |
| `src/auth/` | Keep |
| `src/context/` | Keep; integrate PR session state |
| `src/views/pullRequestProvider.ts` | Keep and evolve |
| `src/views/prDiffProvider.ts` | Keep and evolve; active-PR driven with explicit reload semantics |
| `src/views/prDetailPanel.ts` | Retain as secondary full-details view |
| `src/views/issuesProvider.ts` | Keep |
| `src/views/ciRunsProvider.ts` | Keep in general Gitea workspace; add PR-centric presentation separately if useful |
| `src/commands/prCommands.ts` | Split progressively by workflow responsibility |
| `src/extension.ts` | Evolve into composition/bootstrap rather than workflow coordinator |

## Testing strategy

Each phase adds tests at the lowest stable layer first: domain/session unit tests, pure planning tests, API contract-style tests, command/Git orchestration tests, and extension-host tests where practical. Destructive cleanup safety/error-path coverage is a release requirement rather than deferred polish.

Minimum regression workflows:

1. authenticate and discover repository;
2. list PRs;
3. activate/refresh PR and open diff;
4. create normal or WIP/draft PR;
5. comment/review and mark WIP ready;
6. merge with supported methods and block no-delta/WIP/server-non-mergeable states appropriately;
7. post-merge branch identity, checkout and cleanup;
8. switch repository while a PR is active;
9. coexist with GitHub Pull Requests using the dual Gitea workspace topology.

## Migration rule

A phase is complete only when its new workflow is functional, its documentation/version metadata is coherent, the old behavior it replaces can be removed without losing a supported capability, and the phase release gate has passed. The project should remain buildable and usable at every phase boundary.
