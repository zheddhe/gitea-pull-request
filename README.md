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
| **Active PR session** | Activate one Gitea PR as the contextual workspace state; activation focuses the dedicated Gitea Pull Request workspace |
| **Sidebar PR creation** | Select repository/base/head, edit title/description, inspect Files Changed, choose supported metadata and create normal or draft/WIP PRs |
| **Sidebar PR review** | Comment, approve, request changes, mark WIP PRs ready for review, refresh and merge |
| **Merge readiness** | Distinguish WIP/no-delta/server-side non-mergeable states and surface CI/check, review and branch-policy signals |
| **Merge methods** | Use repository-supported merge commit, squash or rebase methods |
| **Post-merge lifecycle** | Safely choose local/remote branch cleanup, checkout the base without deletion, keep branches, or create a new PR |
| **PR Diff Tree** | Directory tree with file status, viewed-state checkboxes, native `vscode.diff` integration and reload when the active PR head changes |
| **PR Detail** | Full alternative detail panel for description, reviews, commits and metadata |
| **Issues** | Browse, create, close, re-open and comment on issues in the general Gitea workspace |
| **CI / Actions** | Browse runs/jobs, live logs, rerun and cancel operations in the general Gitea workspace |
| **Multi-repo / multi-VCS** | Detect Gitea repositories while allowing GitHub and other forge repositories/extensions to coexist |
| **Status Bar** | Active repository and authentication context |

---

## Multi-VCS coexistence

Gitea Pull Request is designed to coexist with **GitHub Pull Requests and Issues** and other forge integrations in the same VS Code installation/workspace.

Repository discovery is scoped to configured/authenticated Gitea endpoints and excludes public GitHub, GitLab, Bitbucket and Azure DevOps hosts from implicit Gitea detection. A GitHub repository therefore remains managed by the GitHub extension while Gitea repositories are handled by this extension.

Phase 5 exposes two Gitea-specific Activity Bar containers. Their icons are monochrome/theme-compatible and intentionally distinguish the general Gitea workspace from the contextual Gitea Pull Request workspace and from GitHub Pull Requests.

---

## Architecture principles

1. **Sidebar first** — frequent PR operations belong in the Activity Bar workflow.
2. **Native first** — prefer TreeView, QuickPick, commands, context keys, Codicons and `vscode.diff`.
3. **State driven** — PR UI visibility and actions derive from an explicit workspace/session state.
4. **API/UI separation** — Gitea REST access remains isolated from UI providers and commands.
5. **Progressive migration** — avoid a big-bang rewrite of working functionality.
6. **Full details remain available** — detailed legacy/full panels are secondary rather than mandatory for normal PR work.

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

## Development and local installation

Development build, dependency locking, validation, packaging and local installation are centralized in the repository `Makefile`.

The packaging tool is pinned to `@vscode/vsce 3.9.2`; local VSIX packaging therefore requires **Node.js 22+**. The VS Code command-line launcher (`code`) is only required for installation targets.

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

For Phase 5:

```bash
make promote RELEASE_VERSION=0.6.0
```

This updates `package.json` and `package-lock.json` together without creating a Git tag. Review and commit both files together, then run `make verify` and `make reinstall-vsix` before merging the release PR.

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

The current Waiting for my review category uses the available Gitea assignment signals as its discovery heuristic. Exact review state remains authoritative in the contextual review workflow.

### Create Pull Request

The primary creation path opens a dedicated sidebar WebviewView in the general Gitea workspace.

It supports:

- explicit repository selection for multi-repository workspaces;
- BASE and MERGE/head branch selection;
- title and description editing;
- Files Changed preview;
- reviewers, assignees, labels and milestone where supported by Gitea;
- normal and draft/WIP creation;
- safe Cancel and automatic activation of the created PR.

Projects remain intentionally omitted while reliable PR ↔ Project API read/write support is unavailable.

### Activate and refresh a pull request

Activating a PR establishes the active Gitea PR session and automatically focuses the dedicated **Gitea Pull Request** Activity Bar workspace.

The contextual Review view's explicit **Refresh** reloads the PR itself and rebinds Changes in Pull Request. Additional pushed commits therefore update the diff when Refresh is invoked instead of retaining stale cached state.

A native refresh icon directly in the Changes view title is tracked for Phase 6 ergonomics.

### Changes in Pull Request

The **Changes in Pull Request** tree follows the active session and exposes changed files using native VS Code file icons, directory grouping, viewed-state checkboxes and the native diff editor.

An empty diff is a valid loaded state. If the head is already contained in the target branch, the view remains stable and merge is blocked as having no content left to merge.

### Review Pull Request

The contextual **Review Pull Request #N** view supports:

- top-level PR comments;
- Approve and Request Changes;
- **Mark Ready for Review** for Gitea WIP/draft title convention;
- explicit Refresh;
- approval/request-changes state;
- CI/check status where Gitea exposes it;
- branch-policy/mergeability signals;
- repository-supported merge method selection;
- merge only when observed readiness permits it;
- Checkout target/base.

Mergeability is presented separately where possible:

- **Draft / WIP** — intentionally not ready;
- **No changes to merge** — head already contained in target;
- **Not mergeable (Gitea)** — server reports another mergeability blocker.

The extension does not fabricate exact conflicting-file details when the supported Gitea API cannot provide them reliably.

### After merge

After successful merge the active Changes/Review views are replaced in the contextual workspace by **Pull Request #N Merged**.

The post-merge workflow:

- preserves exact PR/repository/head/base context;
- resolves local and remote branch identities independently;
- discovers remote refs directly from Git;
- preselects eligible local + remote deletion choices;
- checks out the base before deleting a checked-out local head;
- prevents local deletion if checkout fails;
- permits independent remote cleanup and reports partial errors;
- supports checkout without deletion;
- supports keeping branches and finishing;
- supports Create New Pull Request;
- returns to idle and removes the merged contextual view once cleanup/completion succeeds.

No branch is deleted merely because its name resembles the PR head; deletion uses resolved repository-local Git identities.

### Full PR details

The existing full PR detail panel remains available as a secondary workflow for deeper inspection.

---

## CI / Actions

General CI / Actions remains in the main Gitea workspace and supports workflow runs, job status, logs, reruns and cancellation. PR-specific readiness/check signals are also surfaced in the contextual Review view. Broader PR-centric CI presentation is tracked for Phase 6.

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
- **Phase 6 / 0.7.0** — secondary workflows and polish

Each phase is reviewed as a coherent release increment: implementation/tests, package + lock metadata, changelog, user documentation, roadmap/Story, Make validation and local VSIX validation must agree before merge.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Existing copyright and license notices are preserved as required by the license.
