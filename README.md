# Gitea Pull Request

**Gitea Pull Request** is a Visual Studio Code extension by **zheddhe** for working with pull requests, reviews, issues and CI context on self-hosted Gitea instances.

The product uses a sidebar-first workflow inspired by the ergonomics of GitHub Pull Requests for VS Code while remaining implemented specifically for Gitea and its REST API.

## Current release line

The standalone product line uses roadmap phases as minor-version boundaries while the extension is still pre-`1.0.0`:

| Phase | Release |
| --- | ---: |
| Phase 0 — product split and foundation | `0.1.0` |
| Phase 1 — active pull-request model | `0.2.0` |
| Phase 2 — sidebar-first PR creation | `0.3.0` |
| Phase 3 — sidebar-first review and merge | `0.4.0` |
| Phase 4 — post-merge lifecycle | `0.5.0` |
| Phase 5 — dedicated Pull Request workspace | `0.6.0` |
| Phase 6 — secondary workflows and polish | `0.7.0` |
| Phase 7 — workflow completion and refresh hardening | `0.8.0` |

Patch releases are reserved for corrections within an existing phase boundary. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the detailed release gate.

## Product direction

The normal workflow is split across two Activity Bar workspaces:

```text
Gitea
├─ Pull Requests
├─ Create Pull Request
├─ Issues
└─ CI / Actions

Gitea Pull Request
├─ Changes in Pull Request
├─ Review Pull Request
└─ Pull Request Merged
```

The first workspace is the general Gitea/forge browser. The second is contextual and follows the currently active pull request through review, merge and post-merge cleanup.

On first entry into the Gitea workspace, detected repository groups plus **All Open** and **Waiting for my review** are expanded by default so the primary open and assigned/review queues are immediately visible.

The dedicated Gitea Pull Request Activity Bar icon is deliberately distinct from the official GitHub Pull Requests icon so both extensions can coexist without relying on color alone for identification.

---

## Current features

| Feature | Description |
| --- | --- |
| **Pull Requests** | Browse Gitea PRs by repository and workflow category, with All Open and Waiting for my review expanded by default |
| **Active PR session** | Activate one Gitea PR as contextual workspace state; activation focuses the dedicated Gitea Pull Request workspace and opens PR Details |
| **Sidebar PR creation** | Select repository, source/base branches, title/description and supported metadata; create normal or draft/WIP PRs |
| **Sidebar PR review** | Manage source/base branches, approve or request changes, inspect checks/readiness, select merge method, merge or close |
| **Merge readiness** | Distinguish WIP/no-delta/server-side non-mergeable states and surface CI/check, review and branch-policy signals |
| **Guided conflict preparation** | Prepare a safe local merge of the fresh remote base into the exact PR source branch, then hand real conflicts to native VS Code Source Control / Merge Editor |
| **Bounded contextual refresh** | Refresh stale PR/CI/mergeability state when the Review view becomes visible again, without hidden polling and without discarding an unsent review draft |
| **Merge methods** | Use repository-supported merge commit, squash or rebase methods |
| **Post-merge lifecycle** | Safely choose local/remote branch cleanup, checkout the base without deletion, keep branches, or create a new PR |
| **PR Diff Tree** | Directory tree with file status, viewed-state checkboxes, native `vscode.diff` integration and reload when the active PR head changes |
| **PR Detail** | Rich detail panel with inline review diffs/comments, review history, discussion, commits, Markdown rendering and inline editing |
| **Issues** | Browse/filter issues, inspect Markdown detail, edit title/description/comments, create/close/re-open/comment, and open in Gitea |
| **CI / Actions** | Browse runs/jobs, live logs, rerun and cancel operations in the general Gitea workspace |
| **Multi-repo / multi-VCS** | Detect Gitea repositories while allowing GitHub and other forge repositories/extensions to coexist |
| **Status Bar** | Active repository and authentication context |

---

## Multi-VCS coexistence

Gitea Pull Request is designed to coexist with **GitHub Pull Requests and Issues** and other forge integrations in the same VS Code installation/workspace.

Repository discovery is scoped to configured/authenticated Gitea endpoints and excludes public GitHub, GitLab, Bitbucket and Azure DevOps hosts from implicit Gitea detection. A GitHub repository therefore remains managed by the GitHub extension while Gitea repositories are handled by this extension.

Two Gitea-specific Activity Bar containers separate general forge browsing from the active pull-request lifecycle. Their icons are monochrome/theme-compatible and intentionally distinguish both Gitea workspaces from GitHub Pull Requests.

---

## Architecture principles

1. **Sidebar first** — frequent PR operations belong in the Activity Bar workflow.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`.
3. **State driven** — PR UI visibility and actions derive from an explicit workspace/session state.
4. **API/UI separation** — Gitea REST access remains isolated from UI providers and commands.
5. **Progressive migration** — avoid a big-bang rewrite of working functionality.
6. **Details where useful** — richer detail panels complement the sidebar when Markdown, discussion history or inline review context needs more space.

---

## Requirements

- VS Code **1.133.0** or later
- Gitea **1.26.4** or later
- A Gitea API token with the required permissions

The `0.8.0` release line keeps the Phase 6 compatibility baseline: VS Code 1.133.0+, Gitea 1.26.4+ and Node.js 24.x for development/build/release tooling.

### Recommended Gitea token permissions

| Permission | Level | Purpose |
| --- | --- | --- |
| **Repository** | Read & Write | Browse PRs, review and merge |
| **Issue** | Read & Write | Browse and manage issues |
| **Misc** | Read | Transversal API operations |
| **User** | Read | Identity/profile lookup |

`Repository: Write` is required for merge, review and other write operations. Read-only usage can use narrower permissions.

---

## Development and local installation

Development build, dependency locking, validation, packaging and local installation are centralized in the repository `Makefile`.

The packaging tool is pinned to `@vscode/vsce 3.9.2`; the development, CI and release baseline is **Node.js 24.x**. The VS Code command-line launcher (`code`) is only required for installation targets.

After a fresh clone, or after modifying `package.json`, synchronize the lock and dependencies with:

```bash
make bootstrap
```

Normal validation:

```bash
make verify
```

Build and reinstall the local VSIX:

```bash
make reinstall-vsix
```

Generated packages are stored under:

```text
.artifacts/vsix/gitea-pull-request-<version>.vsix
```

### Release promotion

Phase development stays on the last merged release version until implementation and documentation are ready for the release gate.

Promote explicitly with:

```bash
make promote RELEASE_VERSION=<target-version>
```

For Phase 7:

```bash
make promote RELEASE_VERSION=0.8.0
```

Promotion must happen **before the release PR is merged**. It updates `package.json` and `package-lock.json` together without creating a Git tag. Review and commit both files together, then run `make verify` and `make reinstall-vsix` before marking the release PR ready to merge.

After merge, tag the merged `main` commit and publish the GitHub Release. Release CI validates the tag/package identity, rebuilds/tests/packages the exact versioned VSIX and attaches it to the GitHub Release. Marketplace publication is intentionally manual: upload that exact release VSIX through the Visual Studio Marketplace publisher management page. No Marketplace PAT or OIDC publishing credential is used by the repository workflow.

Useful targets:

```bash
make help
make doctor
make lock
make bootstrap
make deps
make promote RELEASE_VERSION=x.y.z
make compile
make lint
make test
make test-latest
make verify
make vsix
make rebuild-vsix
make install-vsix
make reinstall-vsix
make show-vsix
make ci
```

---

## Configuration

Run **`Gitea: Sign In`** from the Command Palette and provide the Gitea server URL and API token.

| Setting | Default | Description |
| --- | --- | --- |
| `gitea.serverUrl` | `""` | Override the detected Gitea web/API hostname |
| `gitea.itemsPerPage` | `20` | Pull request / CI items per page |
| `gitea.reviewsPerPage` | `20` | Reviews per page |

Existing command and configuration identifiers remain under the stable `gitea.*` namespace.

---

## Pull request workflow

### General Gitea workspace

The **Gitea** Activity Bar workspace is the discovery/forge view. It contains Pull Requests, Create Pull Request, Issues and CI / Actions.

Pull Requests are grouped by repository and categories such as **All Open**, **Waiting for my review** and **Created by me**. On first entry the repository, All Open and Waiting for my review nodes are expanded so actionable work is visible immediately; users may collapse them afterwards normally.

Pull-request and issue rows are leaf business rows with concise metadata/Markdown hover detail and inline **View Details**, **Open in Browser**, and PR activation actions. Issues additionally expose **Assigned to Me** for the authenticated Gitea user while preserving the complete Open/Closed listing.

The current Waiting for my review category uses the available Gitea assignment signals as its discovery heuristic. Exact review state remains authoritative in the contextual review workflow.

### Create Pull Request

The primary creation path opens a dedicated sidebar WebviewView in the general Gitea workspace. Create mode uses temporary view IDs so its focused layout does not overwrite the user's normal Pull Requests / Issues / CI proportions.

It supports:

- explicit repository selection for multi-repository workspaces;
- **Source branch** and **Base branch** selection;
- a **General information** block with an explicit pull-request title and description;
- native QuickPick metadata flows for reviewers, assignees, labels and milestone, with selected values reflected in the form;
- normal and draft/WIP creation;
- native title **Refresh** that reloads branches while preserving current draft fields and metadata;
- native title **Close** to cancel creation;
- automatic activation of the created PR.

The Create and Review WebviewViews retain their live context while hidden, so unsaved text and selections survive Activity Bar switches without requiring a Refresh first.

The title starts empty rather than being inferred from the branch name. Projects remain intentionally omitted while reliable PR ↔ Project API read/write support is unavailable.

### Activate and refresh a pull request

Activating a PR establishes the active Gitea PR session, focuses the dedicated **Gitea Pull Request** Activity Bar workspace and opens the PR Detail panel.

The contextual Changes and Review views expose the same title-action pattern:

- **View Details**;
- **Open in Browser**;
- **Refresh Active Pull Request**;
- **Close active PR context**.

Manual Refresh reloads the PR itself and rebinds Changes in Pull Request. In addition, the contextual Review view performs a bounded refresh when it becomes visible again after at least 15 seconds since the previous visibility refresh. The refresh is visibility-event driven only: there is no background timer or hidden polling.

The bounded refresh reuses the normal active-session activation path so PR data, diff consumers, checks/readiness and conflict guidance converge on the same fresh server state. An unsent review draft is preserved and does not prevent remote PR/CI/mergeability state from being refreshed.

### Changes in Pull Request

The **Changes in Pull Request** tree follows the active session and exposes branch identity, commits, reviews and changed files using native VS Code tree/file presentation, viewed-state checkboxes and the native diff editor.

An empty diff is a valid loaded state. If the head is already contained in the target branch, the view remains stable and merge is blocked as having no content left to merge.

### Review Pull Request

The contextual **Review Pull Request #N (owner/repository)** view is intentionally action-oriented. Its sections follow the review workflow:

1. **Branch identification** — source branch, editable base branch, and checkout actions for each branch;
2. **Review** — Approve and Request Changes with optional/required review message semantics;
3. **Checks** — PR-centric status summary plus individual Gitea check links;
4. **Merge readiness** — PR state, review state, CI state and available blocker/warning signals;
5. **Actions** — repository-supported merge method, **Merge PR** and **Close PR**.

Top-level PR discussion comments are intentionally kept in PR Detail rather than duplicated in the sidebar Review view.

Mergeability is presented separately where possible:

- **Draft / WIP** — intentionally not ready;
- **No changes to merge** — head already contained in target;
- **Not mergeable (Gitea)** — server reports another mergeability blocker.

When Gitea reports a real non-mergeable PR, the extension can prepare a safe local conflict-resolution workflow. It requires a clean working tree, fetches exact source/base remotes, validates the PR head SHA, safely checks out/fast-forwards the source branch and merges the fresh remote base into it. Real conflicts then remain a normal Git merge state handled by VS Code Source Control / Merge Editor; **Abort Merge** uses standard `git merge --abort` semantics.

Conflict guidance waits while at least one real CI check is pending so an unfinished check does not prematurely trigger a merge-conflict workflow. Completed checks restore normal conflict handling. No exact conflicting-file detail is fabricated when the supported Gitea API cannot provide it reliably.

### PR Detail

PR Detail is the richer inspection/discussion surface and keeps its active tab across refreshes.

Its tabs are:

- **Inline Reviews** — changed files, inline diff, pending inline comments and previously submitted inline comments placed back on their diff lines where Gitea position data permits;
- **Review History** — chronological review events (`APPROVED`, `REQUEST_CHANGES`, `COMMENT`) with Oldest/Newest ordering and associated inline comment bodies when available;
- **Discussion** — Markdown description and top-level PR comments;
- **Commits** — PR commit history.

The PR title, description and discussion comments can be edited inline. Description/comments are rendered using VS Code's Markdown renderer, with explicit HTTP(S) link handling. Browser and Refresh actions are kept next to the title.

### After merge

After successful merge the active Changes/Review views are replaced in the contextual workspace by **Pull Request #N Merged**.

The primary post-merge choices are:

- **✓ Checkout Base / Delete Source** — recommended cleanup path;
- **Checkout Base / Keep Source**;
- **Create New Pull Request**.

The post-merge workflow preserves exact PR/repository/head/base context, resolves local and remote branch identities independently, discovers remote refs directly from Git, checks out the actual PR base before deleting a checked-out local source when required, prevents unsafe local deletion if checkout fails, supports independent remote cleanup and reports partial errors.

Cleanup safety remains enforced through resolved branch identity, branch selection and confirmation even though the normal cleanup choice is not styled as an error/destructive warning. No branch is deleted merely because its name resembles the PR head.

---

## Issues

Issues stay in the general Gitea workspace. A native TreeView/QuickPick control switches between **Open** and **Closed** issue scopes, and **Assigned to Me** follows that current scope.

Issue children keep **View Details** first for fast access, followed by contextual metadata/browser entries. Issue Detail provides:

- inline title editing;
- Markdown description rendering and editing;
- Markdown comment rendering and inline comment editing;
- simple comment creation;
- compact title actions for Open in Browser and Refresh.

Close/Re-open remain issue workflow commands rather than being duplicated inside the detail panel. Notifications/activity feed, saved queries and broader issue search are intentionally deferred because they do not currently justify the added UI/state complexity.

---

## CI / Actions

General CI / Actions remains in the main Gitea workspace and supports workflow runs, job status, logs, reruns and cancellation. Completed runs use their conclusion as the meaningful final state; running states remain explicit, while event/date metadata stays concise and branch/commit detail remains available through hover context.

PR-specific checks are also surfaced in the contextual Review view with explicit external links when Gitea provides a target URL.

---

## Project origin

**Gitea Pull Request** is an independent product/version line originating from an earlier MIT-licensed Gitea VS Code extension codebase and a short-lived enhanced fork. The standalone changelog begins at `0.1.0`; predecessor release history is intentionally not reproduced as current product history.

Inherited copyright/license attribution remains preserved. Contributions intended for the predecessor project should be prepared separately from the appropriate historical fork baseline.

---

## Development roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

- **Phase 0 / 0.1.0** — product split and foundation
- **Phase 1 / 0.2.0** — active pull-request session model
- **Phase 2 / 0.3.0** — sidebar-first PR creation
- **Phase 3 / 0.4.0** — sidebar-first review and merge
- **Phase 4 / 0.5.0** — post-merge lifecycle and branch cleanup
- **Phase 5 / 0.6.0** — dedicated Gitea Pull Request workspace / dual Activity Bar topology
- **Phase 6 / 0.7.0** — secondary workflows, detail ergonomics and polish
- **Phase 7 / 0.8.0** — workflow completion, conflict guidance, Activity Bar signal and safe contextual refresh

Each phase is reviewed as a coherent release increment: implementation/tests, package + lock metadata, changelog, user documentation, roadmap/Story, Make validation and local VSIX validation must agree before merge.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Existing copyright and license notices are preserved as required by the license.
