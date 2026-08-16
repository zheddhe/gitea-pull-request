# Gitea Pull Request — Transformation Roadmap

## Product direction

The extension is evolving from a fork-oriented "Gitea for VS Code — Enhanced" project into an independent product named **Gitea Pull Request**, published by **zheddhe**.

The target user experience is sidebar-first and inspired by the workflow ergonomics of GitHub Pull Requests for VS Code, while remaining implemented specifically for Gitea and its REST API.

The existing codebase remains the technical foundation where it is already healthy: authentication, Gitea API access, repository context, pull request listing, diff tree, issues, CI/actions and native VS Code integration.

## Design principles

1. **Sidebar first** — common pull-request operations should be completed from the Activity Bar without requiring the full detail panel.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`; use WebviewView only when richer form controls are required.
3. **State driven** — UI visibility and actions are derived from an explicit pull-request workspace/session state.
4. **API/UI separation** — Gitea REST concerns stay isolated from UI providers and commands.
5. **Progressive migration** — preserve working functionality while replacing the current PR orchestration incrementally.
6. **Full detail remains available** — the existing PR detail experience remains an alternative/secondary view rather than the primary workflow.

## Versioning during the transformation

Until the product reaches a stable `1.0.0`, each completed transformation phase advances the standalone minor version. This makes installed VSIX packages and changelog entries identify the exact migration boundary being tested.

| Transformation milestone | Product version |
|---|---:|
| Phase 0 — Product split and foundation | `0.1.0` |
| Phase 1 — Active pull-request model | `0.2.0` |
| Phase 2 — Sidebar-first PR creation | `0.3.0` |
| Phase 3 — Sidebar-first review and merge | `0.4.0` |
| Phase 4 — Post-merge branch lifecycle | `0.5.0` |
| Phase 5 — Secondary workflows and polish | `0.6.0` |

Patch versions (`0.x.1`, `0.x.2`, …) are reserved for corrections that do not introduce the next roadmap phase. The phase-to-minor mapping is a migration convention, not a replacement for Semantic Versioning after `1.0.0`.

### Phase completion / release gate

Before a phase PR is marked ready for merge, all of the following must be reviewed together:

1. implementation and tests;
2. `package.json` version and synchronized `package-lock.json`;
3. `CHANGELOG.md` entry for the target version;
4. `README.md` if user-visible behavior, installation or workflow changed;
5. this roadmap and the phase Story acceptance criteria;
6. `make verify` and local VSIX installation/interactive validation for user-visible changes.

Version promotion is intentionally a release-preparation step rather than a prerequisite for every development commit. Use:

```bash
make promote RELEASE_VERSION=<target-version>
```

only once the implementation/documentation is ready for final validation. The phase PR remains draft until the promotion, documentation review and local validation have all passed.

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

### Goal

Establish **Gitea Pull Request** as the canonical product and prepare the codebase for state-driven migration without changing the working PR workflow yet.

### Work

- Rename extension package/display branding to Gitea Pull Request.
- Reset product versioning to a standalone semantic version line (`0.1.0`).
- Replace fork-oriented documentation and metadata.
- Preserve MIT attribution/licensing requirements.
- Keep stable internal command/view IDs under `gitea.*` unless a rename has a concrete technical benefit.
- Introduce the feature-oriented pull-request directory structure progressively rather than through a big-bang move.
- Define initial session state/context keys without wiring destructive workflow behavior.
- Add baseline tests around session transitions before UI migration.
- Add a reproducible Make-based developer workflow for clean dependency installation, compile/lint/test gates, VSIX packaging and local VS Code installation.
- Keep disposable local packages under `.artifacts/vsix/` and align CI packaging with the same Make workflow.

---

## Phase 1 — Active pull-request model

**Release:** `0.2.0`

### Goal

Make one explicit pull request the active workspace context and drive contextual sidebar views from that state.

### Completed

- Implement `PullRequestSessionService` and state/context-key synchronization.
- Activate/clear PR context explicitly.
- Drive `Changes in Pull Request` from the active PR session.
- Preserve the full-detail panel as the secondary workflow.
- Invalidate stale sessions when the repository disappears.
- Isolate Gitea repository discovery from GitHub/GitLab/Bitbucket/Azure DevOps repositories in mixed-VCS workspaces.
- Give the standalone product its own Activity Bar identity/icon.

---

## Phase 2 — Sidebar-first PR creation

**Release target:** `0.3.0`

### Goal

Implement the GitHub-like PR creation workflow inside the sidebar, prioritizing workflow correctness and feature parity before detailed visual/ergonomic polish.

### Target composition

```text
Create Pull Request
  BASE <branch>
  MERGE <branch>
  TITLE
  DESCRIPTION
  reviewers / assignees / labels / milestone / projects
  Files Changed
  Cancel
  Create v
    Create
    Create Draft
```

### Implemented so far

- Dedicated `gitea.createPullRequest` `WebviewView` in the Gitea Pull Request Activity Bar.
- Primary `gitea.createPRSidebar` create path while retaining `gitea.createPR` as a temporary legacy fallback.
- Explicit repository selection in multi-repository workspaces.
- BASE/head branch loading and selection with protection against identical branches.
- Editable title and description.
- Session-driven `idle -> creating -> active` lifecycle.
- Cancel clears the creating state.
- Successful creation refreshes the PR tree and activates the created PR.
- The Create action remains available even when no PR is currently listed.
- Re-invoking Create during an existing creation session focuses the current creation view instead of creating competing state.
- Guarded Make release promotion (`make promote RELEASE_VERSION=0.3.0`) is available for the final release gate.

### Remaining functional work before Phase 2 completion

- Show Files Changed for the selected base/head pair.
- Add native QuickPick flows for reviewers, assignees, labels, milestone and projects where supported by the Gitea API.
- Detect draft-PR capability and expose Create Draft only when supported, with clean degradation otherwise.
- Improve title/body prefill where useful without making generated content mandatory.
- Add create-view orchestration tests at the appropriate stable layer.

### UX scope

The current WebviewView validates the product/workflow architecture. Fine-grained layout, spacing, visual styling and broader ergonomic refinement are **not release blockers for the current implementation increments** unless they prevent use of the workflow. Those concerns are explicitly revisited in **Phase 5 — Secondary workflows and polish**, alongside accessibility and keyboarding review.

### Acceptance criteria

- PR creation can be initiated from the sidebar even with an empty PR list.
- Repository/base/head selection is explicit and coherent.
- Title/description can be edited before creation.
- Create/cancel transitions leave a coherent session state.
- Successful creation refreshes/activates the created PR.
- Files Changed, metadata and supported draft creation reach feature parity before the Phase 2 release gate.
- Documentation/version metadata and local VSIX validation agree at `0.3.0` before merge.

---

## Phase 3 — Sidebar-first review and merge

**Release target:** `0.4.0`

### Goal

Make the normal review/merge loop usable directly from the sidebar.

### Target composition

```text
Changes In Pull Request #N
  Files ...

Review Pull Request #N
  comment editor
  Comment
  checks/conflict summary
  Merge method split button
    Create Merge Commit
    Squash and Merge
    Rebase and Merge
  Checkout '<base>'
```

### Work

- Keep `prDiffProvider` as the basis of the changes tree.
- Add a `WebviewView` for review controls.
- Integrate comments/reviews and mergeability/conflict state.
- Add merge methods: merge commit, squash, rebase when enabled/supported.
- Persist the user's last merge-method preference.
- Surface CI/check state relevant to merge readiness.
- Keep full PR details/history/commits available as an alternative panel.

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

### Work

- Add `BranchCleanupService`.
- Resolve actual local checkout/ref names independently from PR head names.
- Offer local and remote branch deletion separately.
- Checkout base safely before local branch deletion when required.
- Never infer that remote head and local checkout names are identical.

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
- Visual/ergonomic refinement of the Phase 2/3 sidebar workflows (layout, spacing, hierarchy, button treatment and consistency with VS Code conventions).
- Accessibility/keyboarding review.
- Integration tests for command handlers and Gitea API adapters.
- Marketplace packaging and standalone documentation.

---

## Current code disposition

| Current area | Direction |
|---|---|
| `src/api/` | Keep and evolve |
| `src/auth/` | Keep |
| `src/context/` | Keep; integrate PR session state |
| `src/views/pullRequestProvider.ts` | Keep and evolve |
| `src/views/prDiffProvider.ts` | Keep largely intact; make active-PR driven |
| `src/views/prDetailPanel.ts` | Retain as secondary full-details view; progressively reduce orchestration responsibility |
| `src/views/issuesProvider.ts` | Keep |
| `src/views/ciRunsProvider.ts` | Keep; later make CI more PR-contextual |
| `src/commands/prCommands.ts` | Split progressively by workflow responsibility |
| `src/extension.ts` | Evolve into composition/bootstrap rather than workflow coordinator |

## Target pull-request feature structure

The migration should converge toward:

```text
src/features/pullRequests/
  domain/
    pullRequestState.ts
  services/
    pullRequestSessionService.ts
    pullRequestService.ts
    branchCleanupService.ts
  tree/
    pullRequestTreeProvider.ts
    pullRequestChangesProvider.ts
  views/
    createPullRequestView.ts
    reviewPullRequestView.ts
  commands/
    createPullRequest.ts
    activatePullRequest.ts
    checkoutPullRequest.ts
    mergePullRequest.ts
    cleanupBranch.ts
```

Files should move only when the corresponding phase is implemented; avoid a repository-wide rename/move with no behavioral value.

## Testing strategy

Each phase should add tests at the lowest stable layer first:

- session/domain transitions: unit tests;
- API adapter behavior: unit/contract-style tests with mocked HTTP;
- command orchestration: integration-style tests with mocked VS Code/API dependencies;
- critical end-to-end workflows: VS Code extension host tests where practical.

Minimum regression workflows:

1. authenticate and discover repository;
2. list PRs;
3. activate PR and open diff;
4. create PR;
5. comment/review;
6. merge with each supported method;
7. checkout base and branch cleanup;
8. switch repository while a PR is active.

## Migration rule

A phase is complete only when its new workflow is functional, its documentation/version metadata is coherent, the old behavior it replaces can be removed without losing a supported capability, and the phase release gate has passed. The project should remain buildable and usable at every phase boundary.
