# Gitea Pull Request — Transformation Roadmap

## Product direction

The extension is evolving from an earlier Gitea VS Code codebase into an independent product named **Gitea Pull Request**, published by **zheddhe**.

The target user experience is sidebar-first and inspired by the workflow ergonomics of GitHub Pull Requests for VS Code, while remaining implemented specifically for Gitea and its REST API.

The existing codebase remains the technical foundation where it is already healthy: authentication, Gitea API access, repository context, pull request listing, diff tree, issues, CI/actions and native VS Code integration.

The standalone product/version line begins at `0.1.0`. Predecessor/fork releases are historical implementation context rather than part of this roadmap's release sequence; inherited MIT attribution remains preserved by the repository license/history.

## Design principles

1. **Sidebar first** — common pull-request operations should be completed from the Activity Bar without requiring the full detail panel.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`; use WebviewView only when richer form controls are required.
3. **State driven** — UI visibility and actions are derived from an explicit pull-request workspace/session state.
4. **API/UI separation** — Gitea REST concerns stay isolated from UI providers and commands.
5. **Progressive migration** — preserve working functionality while replacing the current PR orchestration incrementally.
6. **Full detail remains available** — the existing PR detail experience remains an alternative/secondary view rather than the primary workflow.

## Versioning during the transformation

Until the product reaches a stable `1.0.0`, each completed transformation phase advances the standalone minor version.

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

Before a phase PR is marked ready for merge, review together:

1. implementation and tests;
2. `package.json` version and synchronized `package-lock.json`;
3. `CHANGELOG.md` entry for the target version;
4. `README.md` if user-visible behavior changed;
5. this roadmap and the phase Story acceptance criteria;
6. `make verify` and local VSIX installation/interactive validation.

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

`active/open` and `reviewing` may share the same underlying session state with contextual capabilities rather than being separate persisted states.

---

## Phase 0 — Product split and foundation

**Release:** `0.1.0`

### Completed

- Standalone Gitea Pull Request product identity and semantic version line.
- MIT attribution/licensing preservation.
- Stable `gitea.*` command/view namespace where useful.
- Session/context-key foundations and baseline tests.
- Reproducible Make-based build/test/package/install workflow.

---

## Phase 1 — Active pull-request model

**Release:** `0.2.0`

### Completed

- `PullRequestSessionService` and state/context synchronization.
- Explicit activate/clear PR context.
- Active-session-driven `Changes in Pull Request`.
- Full detail panel retained as secondary workflow.
- Stale-session invalidation when repositories disappear.
- Gitea repository isolation in mixed-forge workspaces.
- Dedicated standalone Activity Bar identity.

---

## Phase 2 — Sidebar-first PR creation

**Release:** `0.3.0`

### Completed

- Dedicated sidebar create WebviewView.
- Explicit repository/base/head selection.
- Title/description prefill and editing.
- Files Changed preview.
- Reviewers, assignees, labels and milestone where supported.
- Normal and draft/WIP creation.
- Safe `idle -> creating -> active` lifecycle and Cancel behavior.
- Projects intentionally omitted while reliable API read/write support is unavailable.
- Create-flow/domain tests.

---

## Phase 3 — Sidebar-first review and merge

**Release:** `0.4.0`

### Completed

- Contextual `Review Pull Request #N` WebviewView.
- Top-level comments, Approve and Request Changes.
- Review-state icons and default-expanded **Waiting for my review** category.
- Merge readiness combining PR state, reviews, branch policy, CI/checks and mergeability.
- Repository-supported merge/squash/rebase selection with persisted preference.
- Blocking for WIP, checks/reviews/policy, no-diff/already-contained PRs and server-reported non-mergeability.
- Successful real merge with content and `active -> merged` transition.
- Scoped checkout-base action.
- Stable empty-diff terminal state and repository-change deduplication, eliminating observed refresh loops.
- Bounded/normalized readiness/review API paths and diagnostics.
- Legacy PR summary omits unavailable diff statistics rather than fabricating zeros.

### Follow-up robustness carried into Phase 4 development

A conflict case discovered after the `0.4.0` merge confirmed that Gitea may report `mergeable=false` while its Web UI shows conflicting files. The extension now presents this explicitly as an automatic-merge blocker requiring conflict or other server-side mergeability resolution. The supported public API is not treated as if it reliably exposes the exact conflicting-file list, so the extension does not invent file-level conflict details.

---

## Phase 4 — Post-merge branch lifecycle

**Release target:** `0.5.0`

### Goal

Provide explicit, safe cleanup after a successful merge.

### Target composition

```text
Pull request successfully merged.

Create New Pull Request...
Delete Branch...
Checkout '<base>' without deleting branch
```

`Delete Branch...` opens a multi-select flow for local and remote branch deletion.

### Implemented and validated foundation

- Dedicated `gitea.postMergePullRequest` WebviewView visible from the `merged` session state.
- Automatic focus after successful merge.
- Exact merged PR/repository/head/base preserved from the session.
- `BranchCleanupService` bound to the exact VS Code Git repository root.
- Local and remote head/base identities resolved independently.
- Local aliases tracking a differently named remote PR head are preserved correctly.
- Remote resolution does not derive the remote branch name from the local checkout name.
- Multiple-remotes handling prefers `origin` where the same branch is available on several remotes.
- Current/base branch state is surfaced for safe cleanup decisions.
- Pure cleanup planning determines local/remote eligibility and whether checkout-base is required before local deletion.
- Tests cover exact local/remote matching, local aliasing, remote-only heads, origin preference and cleanup safety planning.
- 36 tests pass after adding the Phase 3 conflict-readiness regression case.

### Remaining before Phase 4 completion

- **4.3 — checkout base + local deletion:** execute checkout safely and guarantee that failed checkout prevents local branch deletion.
- **4.4 — remote deletion + independent selection:** allow local and remote deletion to be selected/executed independently.
- **4.5 — lifecycle completion:** implement **Create New Pull Request...**, checkout-base-without-delete and coherent decline/complete transitions to `idle` or the next workflow.
- Add orchestration/error-path tests around destructive Git actions and partial cleanup.
- Perform interactive cleanup validation.
- Review docs/Story/PR, promote to `0.5.0`, run `make verify` and `make reinstall-vsix`.

### Safety invariants

- Never infer that remote head and local checkout names are identical.
- Never offer deletion for a branch identity that was not actually resolved.
- Never delete the currently checked-out local head without first checking out a safe base/target branch.
- A checkout failure must abort local deletion.
- Local and remote cleanup are independent operations; partial cleanup must not corrupt the session state.

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
| `src/views/prDiffProvider.ts` | Keep largely intact; active-PR driven |
| `src/views/prDetailPanel.ts` | Retain as secondary full-details view |
| `src/views/issuesProvider.ts` | Keep |
| `src/views/ciRunsProvider.ts` | Keep; later make CI more PR-contextual |
| `src/commands/prCommands.ts` | Split progressively by workflow responsibility |
| `src/extension.ts` | Evolve into composition/bootstrap rather than workflow coordinator |

## Testing strategy

Each phase adds tests at the lowest stable layer first:

- session/domain transitions: unit tests;
- pure decision/planning logic: unit tests;
- API adapter behavior: unit/contract-style tests with mocked HTTP;
- command/Git orchestration: integration-style tests with mocked VS Code/API dependencies;
- critical end-to-end workflows: VS Code extension host tests where practical.

For destructive Phase 4 cleanup, safety/error-path coverage is a release requirement rather than deferred polish.

Minimum regression workflows:

1. authenticate and discover repository;
2. list PRs;
3. activate PR and open diff;
4. create PR;
5. comment/review;
6. merge with supported methods and block non-mergeable/conflicting states;
7. post-merge branch identity, checkout and cleanup;
8. switch repository while a PR is active.

## Migration rule

A phase is complete only when its new workflow is functional, its documentation/version metadata is coherent, the old behavior it replaces can be removed without losing a supported capability, and the phase release gate has passed. The project should remain buildable and usable at every phase boundary.
