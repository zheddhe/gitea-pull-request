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
7. **Safe freshness** — remote state should become fresh at natural workflow boundaries without hidden polling or destruction of in-progress user input.
8. **Explicit job boundaries** — review snapshots remain authoritative for verification while the local working tree remains authoritative for edits; the extension may bridge them but must not blur their authority.

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
| Phase 7 — Workflow completion and refresh hardening | `0.8.0` |
| Phase 8 — Interactive review + first-class issue authoring | `0.9.0` |

Patch versions (`0.x.1`, `0.x.2`, …) are reserved for corrections that do not introduce the next roadmap phase.

### Phase completion / release gate

Before a phase PR is marked ready for merge, review together implementation/tests, package + lock version metadata, changelog, README, roadmap/Story acceptance criteria, `make verify`, and local VSIX validation.

Promote only when the complete phase is ready:

```bash
make promote RELEASE_VERSION=<target-version>
```

Promotion updates `package.json` and `package-lock.json` together and deliberately does not create a Git tag. Promotion belongs **before merge** so the commit later tagged for the release already carries the exact package version.

After merge, tag the release commit and publish the GitHub Release. Release CI rebuilds/tests/packages the tagged source and attaches the exact VSIX. Marketplace publication is a deliberate manual upload of that release VSIX through the publisher management page; repository CI does not use PAT or OIDC Marketplace credentials.

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

## Phase 1 — Active pull-request model

**Release:** `0.2.0`

Completed: active PR session, contextual Changes view, explicit activation/clear, repository invalidation, mixed-forge isolation, standalone Activity Bar identity.

## Phase 2 — Sidebar-first PR creation

**Release:** `0.3.0`

Completed: dedicated sidebar creation, repo/base/head selection, title/body, supported metadata, normal + WIP/draft creation, safe create lifecycle and tests. Projects remain intentionally omitted while reliable API read/write support is unavailable.

## Phase 3 — Sidebar-first review and merge

**Release:** `0.4.0`

Completed: contextual review view, approve/request-changes, review-state presentation, readiness from CI/reviews/policy/mergeability, merge-method selection, checkout base, real merge, stable zero-diff handling and merged-session transition.

Follow-up robustness carried forward: WIP/no-delta/server-side non-mergeable states remain distinct, active Refresh rebinds the diff when head SHA changes, and unsupported exact conflict-file details are never fabricated.

## Phase 4 — Post-merge branch lifecycle

**Release:** `0.5.0`

Completed: explicit merged-state view, exact repository/branch identity discovery, safe local/remote cleanup, checkout-before-delete, independent remote deletion, Create New Pull Request, checkout-without-delete, keep-branches completion and cleanup safety tests.

## Phase 5 — Dedicated Pull Request workspace

**Release:** `0.6.0`

Completed: dual Activity Bar topology separating general Gitea browsing from the active PR lifecycle. General **Gitea** contains Pull Requests, Create Pull Request, Issues and CI / Actions; contextual **Gitea Pull Request** contains Changes, Review and Pull Request Merged. The contextual icon remains visually distinct from the official GitHub Pull Requests extension.

## Phase 6 — Secondary workflows and polish

**Release:** `0.7.0`

Completed:

- consistent native View Details / Browser / Refresh / lifecycle title actions;
- sidebar Create workflow with branch refresh, metadata QuickPick flows, Source/Base terminology and isolated create-mode layout;
- action-oriented Review workflow organized as Branch identification → Review → Checks → Merge readiness → Actions;
- PR Detail tabs for Inline Reviews, Review History, Discussion and Commits with inline editing/Markdown rendering;
- Issue filtering, Markdown detail editing and streamlined command ownership;
- PR-centric check presentation and diagnostics;
- accessibility, keyboard behavior and deterministic Node.js 24 build/test/package baseline.

Compatibility baseline established at VS Code 1.133.0+, Gitea 1.26.4+ and Node.js 24.x.

## Phase 7 — Workflow completion and refresh hardening

**Release:** `0.8.0`

Completed:

- clearer Activity Bar signals, flatter PR/Issue rows, semantic category icons and **Assigned to Me** issue aggregation;
- business operations exposed through explicit inline row actions instead of parallel right-click menus, with PR actions limited to safe workflow entry points and CI actions scoped by run/job state;
- effective latest-review semantics shared by Merge Readiness and Changes in Pull Request, including immediate review-cache refresh after Approve / Request Changes;
- native VS Code log levels with consistent component-prefixed diagnostics and documented logging semantics;
- guided conflict preparation for non-mergeable PRs, including exact remote/source resolution, PR head-SHA validation, safe local branch handling, native Merge Editor / Source Control hand-off and standard abort behavior;
- CI-aware suppression of conflict guidance while real checks are pending;
- CI run and job actions aligned to actual Gitea capabilities, including individual job re-run while cancellation remains correctly owned by the workflow run;
- harmonized CI Job Logs detail presentation with state badge, compact metadata, Refresh/Browser title actions and aggregated live execution logs;
- compact post-merge choices for deleting or keeping the source branch, or immediately creating another pull request;
- bounded visibility-driven refresh of stale PR/CI state with no hidden polling;
- Create/Review Webview state retention so unsent text and selections survive Activity Bar switches while remote state can still refresh safely;
- reproducible function/branch coverage baseline for directly testable domain logic, used as an informational regression/discovery signal rather than a percentage gate.

The user-facing release summary lives in [`CHANGELOG.md`](../CHANGELOG.md). Test architecture and coverage rationale live in [`TESTING.md`](TESTING.md).

---

## Phase 8 — Interactive review and first-class issue authoring

**Release:** `0.9.0`

**Status:** in progress — Phase 8.1 implemented and interactively validated; Phase 8.2 remains.

Phase 8 is intentionally limited to two P1 stories rather than splitting the release into artificial sub-features:

| Order | Story | Priority | Objective | Status |
|---:|---|:---:|---|---|
| 1 | [#31 — Phase 8.1: Unified interactive pull request review workspace](https://github.com/zheddhe/gitea-pull-request/issues/31) | P1 | Transform PR review into a persistent interactive workspace | Implemented / validated |
| 2 | [#32 — Phase 8.2: Sidebar-first issue authoring workflow](https://github.com/zheddhe/gitea-pull-request/issues/32) | P1 | Give Issue creation the same first-class sidebar quality as PR creation | Planned / next |

### 8.1 — Unified interactive pull request review workspace

Implemented on PR #33:

- neutral Merge Readiness while asynchronous readiness inputs are still consolidating;
- persistent Reviewed/Viewed file state with directory/section propagation, aggregate progress and selective invalidation when a newer PR head changes a file;
- Gitea-aligned inline review conversations with root/reply grouping, same-anchor fallback reconstruction, capability-gated Reply, Resolve/Reopen and compact resolved-thread presentation;
- one persistent **pending review session** for inline comments, replies and lifecycle mutations, preserving review context through refresh and submitting the user-level transaction with one final refresh;
- deterministic partial-failure handling that retains only operations still requiring retry;
- explicit bridge from authoritative `base@PR ↔ head@PR` review snapshots to safe local working files;
- explicit checkout/source guards that reject dirty, divergent or unprovable local mappings rather than silently changing branches;
- distinct **Open Editable PR Diff** mode (`base@PR ↔ working-tree file`) for the reviewer/developer workflow, while keeping the normal PR diff authoritative for review anchors;
- compact PR Detail ergonomics across Inline Reviews, Review History, Discussion and Commits, with actions/metadata kept close to the objects they affect;
- server capability handling: full Reply + Resolve/Reopen interactive validation used Gitea 1.27.2, while unsupported actions remain gated for older servers.

Core product rule established by 8.1:

> Review and modification are connected but distinct jobs. The PR snapshot is authoritative for review; the local working tree is authoritative for edits.

### 8.2 — Sidebar-first issue authoring workflow

Next implementation story:

- dedicated temporary **Create Issue** sidebar workspace aligned with Create Pull Request;
- repository-aware title/Markdown authoring with draft preservation and normal layout restoration;
- `.gitea/ISSUE_TEMPLATE/` discovery and conservative front-matter/default handling;
- native assignee/label/milestone pickers where Gitea read/write support is reliable;
- project/default integration only when the extension can represent and persist it truthfully;
- removal/demotion of the current title-only prompt as the primary creation path.

### `0.9.0` release gate

Do **not** promote package metadata to `0.9.0` until both #31 and #32 are complete. Once Phase 8.2 is implemented and validated:

```bash
make promote RELEASE_VERSION=0.9.0
make verify
make reinstall-vsix
```

Then validate the exact `.artifacts/vsix/gitea-pull-request-0.9.0.vsix`, mark the final Phase 8 PR ready, merge, tag the merged `main` commit as `v0.9.0`, publish the GitHub Release, and manually upload the exact release VSIX to the Marketplace.

---

## Current code disposition

| Current area | Direction |
|---|---|
| `src/api/` | Keep and evolve |
| `src/auth/` | Keep |
| `src/context/` | Keep; integrate PR session state |
| `src/views/pullRequestProvider.ts` | Keep and evolve |
| `src/views/prDiffProvider.ts` | Keep and evolve; authoritative active-PR snapshot plus reviewed-file progress |
| `src/views/prDetailPanel.ts` | Keep as rich interactive PR review/discussion surface |
| `src/views/issuesProvider.ts` | Keep and evolve for Phase 8.2 authoring entry |
| `src/views/issueDetailPanel.ts` | Keep as rich Markdown issue detail/editing WebviewPanel |
| `src/views/ciRunsProvider.ts` | Keep in general Gitea workspace; PR-centric status remains contextual in Review |
| `src/commands/prCommands.ts` | Continue splitting by workflow responsibility when useful |
| `src/extension.ts` | Continue evolving toward composition/bootstrap rather than workflow coordination |

## Testing strategy

Each phase adds tests at the lowest stable layer first: domain/session unit tests, pure planning tests, API contract-style tests, command/Git orchestration tests, presentation/source-contract tests and extension-host tests where practical. Destructive cleanup safety/error-path coverage remains a release requirement rather than deferred polish.

Coverage measurement complements this strategy for directly testable pure modules. It is used to observe function/branch regressions and identify meaningful untested decisions; no global percentage target is part of the release gate.
