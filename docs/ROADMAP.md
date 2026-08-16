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

A target model is:

```ts
export type PullRequestWorkspaceState =
  | { kind: "idle" }
  | {
      kind: "creating";
      repository: RepositoryRef;
      baseBranch: string;
      headBranch: string;
    }
  | {
      kind: "active";
      pullRequest: PullRequest;
      checkoutState: CheckoutState;
    }
  | {
      kind: "merged";
      pullRequest: PullRequest;
      localBranchExists: boolean;
      remoteBranchExists: boolean;
    };
```

The state will be owned by a dedicated `PullRequestSessionService` exposing an `onDidChangeState` event and context-key synchronization.

---

## Phase 0 — Product split and foundation

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

### Acceptance criteria

- Extension builds and starts under the new product identity.
- Existing PR/issue/CI features still register successfully.
- No working API feature is intentionally removed.
- New PR session state has deterministic unit tests.
- Existing detail panel can still be opened.
- `make rebuild-vsix` performs a clean dependency install, validation and VSIX build.
- `make reinstall-vsix` can force-install the generated package through the VS Code CLI.
- Local and CI packaging use the same `.artifacts/vsix/` output convention and validation sequence.

---

## Phase 1 — Active pull-request model

### Goal

Make one explicit pull request the active workspace context and drive contextual sidebar views from that state.

### Work

- Implement `PullRequestSessionService`.
- Add context keys such as:
  - `gitea.prSession.active`
  - `gitea.prSession.creating`
  - `gitea.prSession.merged`
  - `gitea.prSession.checkedOut`
- Selecting/opening a PR activates the session.
- Show/hide `Changes in Pull Request` and `Review Pull Request` contextually.
- Preserve the existing full-detail panel as `Open Full Details`.
- Ensure refresh/repository changes invalidate stale active state safely.

### Acceptance criteria

- A PR can be activated from the Pull Requests tree.
- Changes view follows the active PR.
- Review view visibility follows the active PR.
- Closing/switching repository cannot leave an invalid active PR session.

---

## Phase 2 — Sidebar-first PR creation

### Goal

Implement the GitHub-like PR creation workflow inside the sidebar.

### Target composition

```text
Create
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

### Work

- Add a `WebviewView` for the create form.
- Auto-populate base/head branches and generated title/body where possible.
- Use native QuickPick flows for reviewers, assignees, labels, milestones and projects.
- Implement draft creation where supported by the target Gitea version/API.
- Reuse the existing diff/file comparison services for Files Changed.
- After create: refresh PR trees and activate the newly created PR.

### Acceptance criteria

- Normal and draft PR creation work from the sidebar.
- Metadata selection does not require opening Gitea in a browser when the API supports it.
- Create/cancel transitions restore a coherent sidebar state.

---

## Phase 3 — Sidebar-first review and merge

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

### Acceptance criteria

- Common review comments can be posted inline from the sidebar workflow.
- Merge availability reflects repository/PR state.
- Supported merge methods are selectable without browser navigation.
- Merge success transitions the session to the merged state.

---

## Phase 4 — Post-merge branch lifecycle

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

### Acceptance criteria

- Cleanup options are explicit and non-destructive by default.
- Local-only, remote-only and combined cleanup paths work independently.
- Failure of remote deletion does not corrupt local checkout state.

---

## Phase 5 — Secondary workflows and polish

### Goal

Complete the product around the PR-centric workflow.

### Work

- Notifications/activity feed.
- Richer issue integration.
- PR-centric CI/check presentation.
- Advanced filtering/search/saved queries if useful.
- Markdown rendering and UX polish.
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

A phase is complete only when its new workflow is functional and the old behavior it replaces can be removed without losing a supported capability. The project should remain buildable and usable at every phase boundary.
