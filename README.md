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
- review, comment and merge pull requests;
- surface checks/conflict state;
- handle post-merge branch cleanup;
- keep the full pull-request detail panel available as a secondary view.

The migration is incremental. Existing working functionality is preserved while the pull-request orchestration is progressively moved to a state-driven, sidebar-first model.

---

## Current features

| Feature | Description |
| --- | --- |
| **Pull Requests** | Browse and filter Gitea PRs with repository/category grouping |
| **Active PR session** | Activate one Gitea PR as the contextual workspace state; switching PR updates the contextual changes view |
| **Sidebar PR creation** | Start a creation session from the Pull Requests view, choose repository/base/head, edit title/description, create or cancel without opening a full editor panel |
| **Inline Code Review** | Review diffs, comment, approve, request changes and submit reviews |
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

For Phase 2:

```bash
make promote RELEASE_VERSION=0.3.0
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

The **Pull Requests** panel groups Gitea PRs by repository and categories such as **Waiting For My Review**, **Created By Me** and **All Open**. The **Create Pull Request** action remains available from the view even when there are currently no open PRs.

### Create Pull Request

The Phase 2 creation path opens a dedicated **Create Pull Request** WebviewView in the Activity Bar rather than a full editor panel.

The current workflow supports:

- explicit Gitea repository selection when multiple repositories are available;
- BASE and MERGE/head branch selection;
- title and description editing;
- prevention of identical base/head branch creation;
- **Create** to submit through the Gitea API;
- **Cancel** to leave the `creating` session without stale state;
- automatic PR-tree refresh and activation of the newly created PR;
- a legacy creation command as a temporary compatibility fallback during Phase 2 migration.

Additional Phase 2 capabilities — Files Changed, metadata QuickPicks and draft creation — are completed incrementally before the `0.3.0` release gate. Detailed visual/ergonomic refinement is intentionally deferred to the later UX/polish phase so Phase 2 can focus on workflow correctness and feature parity.

### Activate a pull request

A PR can be activated from the Pull Requests tree. The active PR becomes the current Gitea PR workspace context. Activating another PR replaces that context rather than opening an independent persistent diff state.

### Changes in Pull Request

The **Changes in Pull Request** tree follows the active PR session and exposes changed files using native VS Code file icons, directory grouping, viewed-state checkboxes and the native diff editor.

### Full PR details

The existing detailed PR webview remains available through **Open Full Pull Request Details** for deeper inspection while the normal workflow is progressively moved inline into the sidebar.

---

## CI / Actions

The CI view supports workflow runs, job status, live log viewing, reruns and cancellation. Gitea API limitations can prevent step-level structured data from being available; raw job logs remain usable in those cases.

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
