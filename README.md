# Gitea Pull Request

**Gitea Pull Request** is a Visual Studio Code extension by **zheddhe** for working with pull requests, reviews, issues and CI context on self-hosted Gitea instances.

The project is evolving toward a **sidebar-first** pull-request workflow inspired by the ergonomics of GitHub Pull Requests for VS Code while remaining implemented specifically for Gitea and its REST API.

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

Patch releases are reserved for corrections within an existing phase boundary. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the detailed release gate.

## Product direction

The primary workflow stays in the VS Code Activity Bar and is now split into two Gitea workspaces:

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

The **Gitea** workspace is the forge-level entry point. The **Gitea Pull Request** workspace follows one active PR. Activating a PR focuses the contextual workspace; after merge, the same workspace owns the post-merge lifecycle.

The two Activity Bar icons are intentionally distinct and monochrome so the Gitea forge workspace, Gitea pull-request workspace and official GitHub Pull Requests extension can coexist without relying on color alone for identification.

---

## Current features

| Feature | Description |
| --- | --- |
| **Pull Requests** | Browse and filter Gitea PRs with repository/category grouping, including a default-expanded **Waiting for my review** category |
| **Active PR session** | Activate one Gitea PR as the contextual workspace state; switching or refreshing PR updates contextual Changes/Review views |
| **Sidebar PR creation** | Select repository/base/head, edit title/description, inspect Files Changed, choose supported metadata and create normal or draft/WIP PRs |
| **Sidebar PR review** | Comment, approve, request changes, mark WIP PRs ready for review, refresh and merge from the contextual Review Pull Request view |
| **Merge readiness** | Distinguish WIP/no-delta/server-side non-mergeable states and surface CI/check, review and branch-policy signals before enabling merge |
| **Merge methods** | Use repository-supported merge commit, squash or rebase methods from the sidebar |
| **Post-merge lifecycle** | After merge, safely choose local/remote branch cleanup, checkout the base without deletion, keep branches, or create a new PR |
| **PR Diff Tree** | Sidebar directory tree with file status, viewed-state checkboxes, `vscode.diff` integration and reload when the active PR head changes |
| **PR Detail** | Full alternative detail panel for description, reviews, commits and metadata |
| **Issues** | Browse, create, close, re-open and comment on issues |
| **CI / Actions** | Workflow runs, jobs, live logs, rerun and cancel operations in the general Gitea workspace |
| **Multi-repo / multi-VCS** | Detect Gitea repositories while allowing GitHub and other forge repositories to coexist in the same workspace |
| **Status Bar** | Active repository and authentication context |

---

## Multi-VCS coexistence

Gitea Pull Request is designed to coexist with extensions such as **GitHub Pull Requests and Issues** in a workspace containing repositories from several forges.

Repository discovery is scoped to Gitea endpoints known through authentication/configuration and excludes public GitHub, GitLab, Bitbucket and Azure DevOps hosts from implicit Gitea detection. A GitHub repository therefore remains managed by the GitHub extension while Gitea repositories appear in the **Gitea** Activity Bar workspace.

The contextual **Gitea Pull Request** Activity Bar icon uses pull-request visual language but deliberately has a different silhouette from the official GitHub Pull Requests icon.

---

## Architecture principles

1. **Sidebar first** — frequent PR operations belong in the Activity Bar workflow.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`.
3. **State driven** — PR UI visibility and actions derive from an explicit workspace/session state.
4. **API/UI separation** — Gitea REST access remains isolated from UI providers and commands.
5. **Progressive migration** — avoid a big-bang rewrite of working functionality.
6. **Full details remain available** — detailed webviews are secondary rather than mandatory for normal PR work.

---

## Requirements

- VS Code **1.85** or later
- Gitea **v1.17+**
- A Gitea API token with the required permissions

### Recommended Gitea token permissions

| Permission | Level | Purpose |
| --- | --- | --- |
| **Repository** | Read & Write | Browse PRs, review and merge |
| **Issue** | Read & Write | Browse and manage issues |
| **Misc** | Read | Transversal API operations |
| **User** | Read | Identity/profile lookup |

`Repository: Write` is required for merge, review and other write operations. Read-only usage can use narrower permissions.

---

## Installation

Development build, dependency locking, validation, packaging and local installation are centralized in the repository `Makefile`.

The packaging tool is pinned to `@vscode/vsce 3.9.2`; local VSIX packaging therefore requires **Node.js 22+**.

After a fresh clone, or after modifying package metadata, use `make bootstrap`. Strict dependency install remains available through `make deps`; use `make lock` when package metadata intentionally changes.

Phase development stays on the last merged release version until release preparation. Promote Phase 5 explicitly with:

```bash
make promote RELEASE_VERSION=0.6.0
```

For normal validation/package/install loops:

```bash
make verify
make rebuild-vsix
make reinstall-vsix
```

Generated packages are kept under `.artifacts/vsix/`.

Marketplace publication uses the standalone extension identity **Gitea Pull Request** (`publisher: zheddhe`).

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

The **Gitea** Activity Bar workspace contains **Pull Requests**, **Create Pull Request**, **Issues** and **CI / Actions**.

The Pull Requests panel groups Gitea PRs by repository and categories such as **Waiting for my review**, **Created by me** and **All Open**. Waiting for my review is expanded by default. The create action remains available even when no PR is currently listed.

### Create Pull Request

The creation path opens a dedicated **Create Pull Request** WebviewView in the general Gitea workspace. It supports repository/base/head selection, title/description, Files Changed, reviewers, assignees, labels, milestone, normal creation and WIP/draft creation. Projects remain intentionally omitted while reliable PR ↔ Project API read/write support is unavailable.

### Activate and enter the PR workspace

Activating a PR establishes the active Gitea PR session and automatically focuses the dedicated **Gitea Pull Request** Activity Bar workspace.

### Changes in Pull Request

The contextual tree follows the active PR session and exposes changed files using native VS Code file icons, directory grouping, viewed-state checkboxes and the native diff editor. An empty diff is a valid loaded state. Explicit PR Refresh reloads the PR and rebinds the diff if additional pushed commits change its head SHA.

### Review Pull Request

The contextual review view supports comments, Approve, Request Changes, Mark Ready for Review for WIP PRs, explicit Refresh, CI/check/readiness state, supported merge methods and checkout of the base branch.

Mergeability distinguishes **Draft / WIP**, **No changes to merge**, and **Not mergeable (Gitea)**. The server remains authoritative and the extension does not fabricate unavailable conflict-file details.

### After merge

The active session moves to `merged`, Changes/Review leave the contextual workflow, and **Pull Request #N Merged** becomes the post-merge view in the same dedicated PR workspace.

The post-merge lifecycle supports independent local/remote branch deletion, checkout-base-before-local-delete safety, checkout without deletion, keeping branches, and starting a new PR.

### Full PR details

The existing detailed PR webview remains available through **Open Full Pull Request Details** as a secondary workflow.

---

## CI / Actions

The general **Gitea** workspace keeps the CI / Actions browser for workflow runs, job status, live logs, reruns and cancellation. PR-specific readiness/check information remains visible in Review Pull Request. A more PR-centric check presentation is deferred to Phase 6 without removing the general CI browser.

---

## Project origin

**Gitea Pull Request** is an independent product/version line. It originated from an earlier MIT-licensed Gitea VS Code extension codebase and a short-lived enhanced fork, but the standalone changelog starts at `0.1.0` rather than reproducing predecessor release history.

Inherited copyright/license attribution remains preserved. Contributions intended for the predecessor project can be prepared separately from an appropriate historical fork baseline.

---

## Development roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

- **Phase 0 / 0.1.0** — product split and foundation
- **Phase 1 / 0.2.0** — active pull-request session model
- **Phase 2 / 0.3.0** — sidebar-first PR creation
- **Phase 3 / 0.4.0** — sidebar-first review and merge
- **Phase 4 / 0.5.0** — post-merge lifecycle and branch cleanup
- **Phase 5 / 0.6.0** — dedicated Pull Request workspace
- **Phase 6 / 0.7.0** — secondary workflows and polish

Each phase is reviewed as a coherent release increment: code/tests, package + lock metadata, changelog, user documentation, roadmap/Story, Make validation and local VSIX validation must agree before the phase PR is merged.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Existing copyright and license notices are preserved as required by the license.
