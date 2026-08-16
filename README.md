# Gitea Pull Request

**Gitea Pull Request** is a Visual Studio Code extension by **zheddhe** for working with pull requests, reviews, issues and CI context on self-hosted Gitea instances.

The project is evolving toward a **sidebar-first** pull-request workflow inspired by the ergonomics of GitHub Pull Requests for VS Code while remaining implemented specifically for Gitea and its REST API.

## Product direction

The primary workflow is intended to stay in the VS Code Activity Bar as much as possible:

- browse pull requests grouped by repository and workflow category;
- create pull requests;
- inspect changed files with the native VS Code diff editor;
- review, comment and merge pull requests;
- surface checks/conflict state;
- handle post-merge branch cleanup;
- keep the full pull-request detail panel available as a secondary view.

The migration is incremental. Existing working functionality is preserved while the pull-request orchestration is progressively moved to a state-driven, sidebar-first model.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the transformation phases and architecture decisions.

---

## Current features

| Feature | Description |
| --- | --- |
| **Pull Requests** | Browse, filter, merge, close and re-open PRs with category folders |
| **Inline Code Review** | Review diffs, comment, approve, request changes and submit reviews |
| **PR Diff Tree** | Sidebar directory tree with file status, viewed-state checkboxes and `vscode.diff` integration |
| **PR Detail** | Full alternative detail panel for description, reviews, commits and metadata |
| **Issues** | Browse, create, close, re-open and comment on issues |
| **CI / Actions** | Workflow runs, jobs, live logs, rerun and cancel operations |
| **Multi-repo** | Detect Git repositories/remotes in the current workspace |
| **Status Bar** | Active repository and authentication context |

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

Development build, validation, packaging and local installation are centralized in the repository `Makefile` so the same sequence can be reproduced consistently.

The packaging tool is pinned to `@vscode/vsce 3.9.2`; local VSIX packaging therefore requires **Node.js 22+**. The VS Code command-line launcher (`code`) is only required for the installation targets.

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

`.artifacts/` is ignored by Git and is the canonical location for disposable local build outputs. The directory can later host other generated developer artifacts without polluting the repository root.

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
make compile        # TypeScript only
make lint           # ESLint only
make test           # compile + extension tests
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

Existing internal command, configuration and view identifiers remain under the stable `gitea.*` namespace during the product split.

---

## Pull request workflow

### Pull Requests

The **Pull Requests** panel groups PRs by repository and categories such as **Waiting For My Review**, **Created By Me** and **All Open**.

### Changes in Pull Request

The **Changes in Pull Request** tree exposes changed files using native VS Code file icons, directory grouping, viewed-state checkboxes and the native diff editor.

### Full PR details

The existing detailed PR webview remains available for deeper inspection while the normal workflow is progressively moved inline into the sidebar.

---

## CI / Actions

The CI view supports workflow runs, job status, live log viewing, reruns and cancellation. Gitea API limitations can prevent step-level structured data from being available; raw job logs remain usable in those cases.

---

## Development roadmap

The current transformation is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md).

The high-level phases are:

- **Phase 0** — product split and foundation
- **Phase 1** — active pull-request session model
- **Phase 2** — sidebar-first PR creation
- **Phase 3** — sidebar-first review and merge
- **Phase 4** — post-merge lifecycle and branch cleanup
- **Phase 5** — secondary workflows and polish

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Existing copyright and license notices are preserved as required by the license.
