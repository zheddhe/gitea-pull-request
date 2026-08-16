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
| Phase 5 — Secondary workflows and polish | `0.6.0` |

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

**Release target:** `0.5.0`

### Goal

Provide an explicit, safe post-merge lifecycle comparable to the common GitHub Pull Requests cleanup flow.

### Implemented

- Dedicated `gitea.postMergePullRequest` WebviewView bound to the merged session and focused after merge.
- Exact merged PR/repository/head/base preserved from the session.
- `BranchCleanupService` scoped to the exact VS Code Git repository root.
- Local and remote identities resolved independently; local aliases and differently named remote PR heads are supported.
- Remote refs are discovered from Git refs directly so `origin/<branch>` identities are not lost through VS Code Git API representation differences.
- **Delete Branch...** opens independent local/remote multi-selection; both eligible choices are preselected by default.
- Checked-out local PR head requires successful checkout of the base before deletion; checkout failure prevents local deletion.
- Remote cleanup remains independent from local cleanup; partial failure preserves the merged context and reports the failed operation.
- **Checkout '<base>' without deleting branch**.
- **Keep branches and finish**.
- **Create New Pull Request...** clears the merged state and starts a clean creation workflow; recreation as WIP/draft has been interactively validated.
- Successful cleanup/completion returns the session coherently to `idle` or to the new creation workflow.
- Safety tests cover identity resolution, cleanup planning, checkout-before-delete ordering, checkout failure, remote-only cleanup and partial remote failure.

### Interactive validation already completed

- dedicated post-merge state and exact PR context;
- local + remote branch cleanup with both selected by default;
- actual deletion of both local and `origin/gitea/test` remote branches;
- independent local/remote cleanup selection behavior;
- Create New Pull Request transition, including WIP/draft recreation;
- inherited no-diff/WIP/conflict readiness behavior.

The Story remains the detailed checklist for the remaining manually testable cases.

### Release gate remaining

- review final README / CHANGELOG / ROADMAP / Story / PR;
- run `make verify` with the final code;
- promote atomically with:

```bash
make promote RELEASE_VERSION=0.5.0
```

- run `make verify` again after promotion;
- run `make reinstall-vsix` and final smoke validation;
- mark PR ready and merge only when docs, version metadata and interactive validation agree.

### Safety invariants

- Never infer that remote head and local checkout names are identical.
- Never offer deletion for a branch identity that was not actually resolved.
- Never delete the currently checked-out local head without first checking out a safe base/target branch.
- A checkout failure aborts local deletion.
- Local and remote cleanup are independent operations; partial cleanup does not corrupt the session state.

---

## Phase 5 — Secondary workflows and polish

**Release target:** `0.6.0`

### Goal

Complete the product around the PR-centric workflow and perform the dedicated UX/ergonomic refinement pass.

### Work

- Notifications/activity feed.
- Richer issue integration.
- PR-centric CI/check presentation.
- Advanced filtering/search/saved queries if useful.
- Markdown rendering.
- Visual/ergonomic refinement of Phase 2/3/4 sidebar workflows.
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
| `src/views/ciRunsProvider.ts` | Keep; later make CI more PR-contextual |
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
8. switch repository while a PR is active.

## Migration rule

A phase is complete only when its new workflow is functional, its documentation/version metadata is coherent, the old behavior it replaces can be removed without losing a supported capability, and the phase release gate has passed. The project should remain buildable and usable at every phase boundary.
