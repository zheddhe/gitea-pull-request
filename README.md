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
| Phase 5 — secondary workflows and polish | `0.6.0` |

Patch releases are reserved for corrections within an existing phase boundary. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the detailed release gate.

## Product direction

The primary workflow is intended to stay in the VS Code Activity Bar as much as possible:

- browse pull requests grouped by repository and workflow category;
- activate one pull request as the current workspace context;
- create pull requests from a dedicated sidebar form;
- inspect changed files with the native VS Code diff editor;
- comment, approve, request changes and merge pull requests;
- surface CI/check and merge-readiness state;
- handle post-merge branch cleanup;
- keep the full pull-request detail panel available as a secondary view.

The migration is incremental. Existing working functionality is preserved while the pull-request orchestration is progressively moved to a state-driven, sidebar-first model.

---

## Current features

| Feature | Description |
| --- | --- |
| **Pull Requests** | Browse and filter Gitea PRs with repository/category grouping, including a default-expanded **Waiting for my review** category |
| **Active PR session** | Activate one Gitea PR as the contextual workspace state; switching PR updates contextual Changes/Review views |
| **Sidebar PR creation** | Select repository/base/head, edit title/description, inspect Files Changed, choose supported metadata and create normal or draft/WIP PRs |
| **Sidebar PR review** | Comment, approve or request changes directly from a contextual Review Pull Request view |
| **Merge readiness** | Surface available CI/check, review, branch-policy and mergeability signals before enabling merge |
| **Merge methods** | Use repository-supported merge commit, squash or rebase methods from the sidebar |
| **Post-merge state** | After merge, show the exact merged PR and resolve local/remote branch identities independently before cleanup |
| **PR Diff Tree** | Sidebar directory tree with file status, viewed-state checkboxes and `vscode.diff` integration |
| **PR Detail** | Full alternative detail panel for description, reviews, commits and metadata |
| **Issues** | Browse, create, close, re-open and comment on issues |
| **CI / Actions** | Workflow runs, jobs, live logs, rerun and cancel operations |
| **Multi-repo / multi-VCS** | Detect Gitea repositories while allowing GitHub and other forge repositories to coexist in the same workspace |
| **Status Bar** | Active repository and authentication context |

---

## Multi-VCS coexistence

Gitea Pull Request is designed to coexist with extensions such as **GitHub Pull Requests and Issues** in a workspace containing repositories from several forges.

Repository discovery is scoped to Gitea endpoints known through authentication/configuration and excludes public GitHub, GitLab, Bitbucket and Azure DevOps hosts from implicit Gitea detection. A GitHub repository should therefore remain managed by the GitHub extension while Gitea repositories appear in the dedicated **Gitea Pull Request** Activity Bar container.

The standalone Activity Bar container has its own identifier and layout state; it does not reuse the legacy pre-standalone container identity.

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

### Development / local VSIX

Development build, dependency locking, validation, packaging and local installation are centralized in the repository `Makefile` so the same sequence can be reproduced consistently.

The packaging tool is pinned to `@vscode/vsce 3.9.2`; local VSIX packaging therefore requires **Node.js 22+**. The VS Code command-line launcher (`code`) is only required for the installation targets.

### Dependency manifest and lock-file workflow

`package.json` is the dependency manifest. `package-lock.json` is the committed reproducibility lock and **must be regenerated whenever dependency declarations or relevant package metadata in `package.json` change**.

After a fresh clone, or after modifying `package.json`, run:

```bash
make bootstrap
```

This first executes:

```bash
npm install --package-lock-only --ignore-scripts
```

which creates or updates `package-lock.json`, then runs `npm ci` against the synchronized lock file.

The two steps are also available separately:

```bash
make lock       # create/update package-lock.json from package.json
make deps       # strict reproducible install from the committed lock file
```

`make deps` deliberately uses only `npm ci` and therefore fails when `package.json` and `package-lock.json` are out of sync. This is intentional: normal builds and CI must never silently rewrite dependency resolution. If `make lock` changes `package-lock.json`, review and commit it together with the corresponding `package.json` change.

### Release promotion

Phase development stays on the last merged release version until the functional work and documentation are ready for the release gate. Promote the phase version explicitly with:

```bash
make promote RELEASE_VERSION=<target-version>
```

For Phase 4, once the complete post-merge lifecycle and release gate are ready:

```bash
make promote RELEASE_VERSION=0.5.0
```

This performs the package/version update without creating a Git tag, keeps `package.json` and `package-lock.json` synchronized, and validates the resulting lock state. Review and commit both files together before final VSIX validation.

### Clean build and VSIX

Run a complete clean rebuild:

```bash
make rebuild-vsix
```

This performs, in order:

1. removal of previous TypeScript/build artifacts;
2. `npm ci` from the committed lock file;
3. TypeScript compilation;
4. ESLint validation;
5. extension tests;
6. VSIX packaging.

Generated packages are kept outside the source tree under:

```text
.artifacts/vsix/gitea-pull-request-<version>.vsix
```

`.artifacts/` is ignored by Git and is the canonical location for disposable local build outputs.

To force-install the package that was just built into the local VS Code installation:

```bash
make install-vsix
```

For the normal end-to-end developer loop, use:

```bash
make reinstall-vsix
```

which performs a clean rebuild and then executes the equivalent of:

```bash
code --install-extension .artifacts/vsix/gitea-pull-request-<version>.vsix --force
```

Useful targets:

```bash
make help           # list targets
make doctor         # validate Node/npm/npx and report VS Code CLI availability
make lock           # create/update package-lock.json from package.json
make bootstrap      # sync package-lock.json, then npm ci
make deps           # strict npm ci; fail when manifest and lock differ
make promote RELEASE_VERSION=x.y.z # promote a phase/release version atomically
make compile        # TypeScript only
make lint           # ESLint only
make test           # compile + tests on minimum supported VS Code
make test-latest    # tests against latest stable VS Code
make verify         # compile + lint + tests
make vsix           # verify + package, without reinstalling dependencies
make rebuild-vsix   # clean + npm ci + verify + package
make install-vsix   # install the already-built VSIX
make reinstall-vsix # clean rebuild + local installation
make show-vsix      # print the generated VSIX path
make ci             # reproduce the clean CI build/package sequence
```

If a different VS Code-compatible launcher is used, override it explicitly, for example:

```bash
make install-vsix CODE=codium
```

Marketplace publication will use the standalone extension identity **Gitea Pull Request** (`publisher: zheddhe`).

---

## Configuration

Run **`Gitea: Sign In`** from the Command Palette and provide the Gitea server URL and API token.

| Setting | Default | Description |
| --- | --- | --- |
| `gitea.serverUrl` | `""` | Override the detected Gitea web/API hostname |
| `gitea.itemsPerPage` | `20` | Pull request / CI items per page |
| `gitea.reviewsPerPage` | `20` | Reviews per page |

Existing command and configuration identifiers remain under the stable `gitea.*` namespace. The standalone Activity Bar container uses its own product-specific identifier so it can coexist with the previous extension layout and other forge extensions.

---

## Pull request workflow

### Pull Requests

The **Pull Requests** panel groups Gitea PRs by repository and categories such as **Waiting for my review**, **Created by me** and **All Open**. **Waiting for my review** is expanded by default. The group itself uses neutral folder semantics; review-state coloring is applied to individual PR items instead.

The **Create Pull Request** action remains available even when there are currently no open PRs.

The expandable legacy PR summary only displays diff statistics when Gitea actually supplies those fields. Missing statistics are omitted rather than presented as a misleading `0 / 0 / 0`; the contextual **Changes in Pull Request** view remains the authoritative file-diff workflow.

### Create Pull Request

The creation path opens a dedicated **Create Pull Request** WebviewView in the Activity Bar rather than a full editor panel.

The workflow supports:

- explicit Gitea repository selection when multiple repositories are available;
- BASE and MERGE/head branch selection;
- title and description editing with useful branch-based prefill;
- prevention of identical base/head branch creation;
- Files Changed for the selected source/target pair;
- reviewers, assignees, labels and milestone selection where supported by the connected Gitea API;
- normal **Create** and draft/WIP creation;
- **Cancel** without leaving stale `creating` session state;
- automatic PR-tree refresh and activation of the newly created PR;
- the previous creation flow retained as a compatibility fallback while migration remains incremental.

Projects are intentionally not exposed as PR metadata while the extension cannot reliably read and persist PR ↔ Project assignment through the supported Gitea API surface.

### Activate a pull request

A PR can be activated from the Pull Requests tree. The active PR becomes the current Gitea PR workspace context. Activating another PR replaces that context rather than opening an independent persistent diff state.

### Changes in Pull Request

The **Changes in Pull Request** tree follows the active PR session and exposes changed files using native VS Code file icons, directory grouping, viewed-state checkboxes and the native diff editor.

An empty diff is a valid loaded state. If the PR head is already contained in the target branch, the view remains stable instead of repeatedly reloading, and merge is blocked as having no content left to merge.

### Review Pull Request

When a PR is active, the contextual **Review Pull Request #N** view follows the same session and supports:

- top-level PR comments;
- Approve and Request Changes actions;
- current approval/request-changes state;
- combined CI/check status where Gitea exposes it;
- available target-branch policy/mergeability signals;
- repository-supported merge method selection;
- merge only when the observed readiness signals permit it;
- **Checkout '<base>'** for the active repository.

A PR reported by Gitea with `mergeable=false` is blocked explicitly. The view explains that conflicts with the target branch or another server-side mergeability blocker must be resolved first; it does not fabricate a conflicting-file list that the supported public API does not reliably provide.

The Gitea server remains authoritative: permission, policy and merge errors are surfaced rather than overridden by the extension.

### After merge

After a successful merge, the session moves from `active` to `merged`. The active Changes/Review views disappear and the dedicated **Pull Request #N Merged** view becomes the post-merge context.

The current Phase 4 foundation:

- preserves the exact merged PR, repository, head and base from the session;
- resolves actual local and remote branch identities independently;
- supports a differently named local branch that tracks the PR remote head;
- prefers `origin` when the same remote branch exists on multiple remotes;
- shows current/base branch state and allows a manual branch-state refresh;
- computes cleanup eligibility and whether checkout of the base is required before local deletion.

Destructive branch cleanup and lifecycle-completion actions remain Phase 4 work until they are implemented and validated. No branch is deleted merely because its name resembles the PR head.

### Full PR details

The existing detailed PR webview remains available through **Open Full Pull Request Details** for deeper inspection while the normal workflow is progressively moved inline into the sidebar.

---

## CI / Actions

The CI view supports workflow runs, job status, live log viewing, reruns and cancellation. Gitea API limitations can prevent step-level structured data from being available; raw job logs remain usable in those cases.

---

## Project origin

**Gitea Pull Request** is now an independent product/version line. It originated from an earlier MIT-licensed Gitea VS Code extension codebase and a short-lived enhanced fork, but the standalone changelog starts at `0.1.0` rather than reproducing predecessor release history.

This keeps the current release documentation tied to this product while preserving inherited copyright/license attribution. Any contribution intended for the predecessor project can be prepared separately from an appropriate historical fork baseline.

---

## Development roadmap

The current transformation is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md).

The high-level phases are:

- **Phase 0 / 0.1.0** — product split and foundation
- **Phase 1 / 0.2.0** — active pull-request session model
- **Phase 2 / 0.3.0** — sidebar-first PR creation
- **Phase 3 / 0.4.0** — sidebar-first review and merge
- **Phase 4 / 0.5.0** — post-merge lifecycle and branch cleanup
- **Phase 5 / 0.6.0** — secondary workflows and polish, including broader visual/ergonomic refinement

Each phase is reviewed as a coherent release increment: code/tests, package + lock metadata, changelog, user documentation, roadmap/Story, Make validation and local VSIX validation must agree before the phase PR is merged.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Existing copyright and license notices are preserved as required by the license.
