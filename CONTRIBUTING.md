# Contributing to Gitea Pull Request

Thank you for your interest in contributing! Please read this guide before opening issues or pull requests.

---

## Development Setup

### Prerequisites

- **Node.js 24.x**
- **npm** compatible with Node.js 24
- **VS Code 1.133.0+**
- **Gitea 1.26.4+** for integration/functional testing

### Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/zheddhe/gitea-pull-request.git
cd gitea-pull-request

# 2. Synchronize the lock file and install dependencies
make bootstrap

# 3. Open in VS Code
code .
```

### Running in Development Mode

Press **F5** (or `Run → Start Debugging`) to launch the Extension Development Host — a new VS Code window with the extension loaded from source.

Any TypeScript changes require recompiling:

```bash
make compile
# or keep a watcher running:
npm run watch
```

### Validation, coverage and VSIX packaging

Run the same local quality gate used before packaging:

```bash
make verify
```

Measure the directly testable pure-module coverage baseline with:

```bash
make coverage
```

Coverage is an observational development signal, not a release percentage gate. The command reports function and branch coverage for the explicitly instrumented pure modules and writes `.artifacts/coverage/coverage-summary.json`. Use changes in that baseline to investigate newly uncovered functions or decision paths; do not optimize tests for a global percentage.

The regular `make test` suite still runs inside the VS Code Extension Host and remains the functional/integration gate. Coverage deliberately uses a separate direct Node/Mocha path so Extension Host glue does not produce a misleading global figure.

Build and reinstall the versioned VSIX locally with:

```bash
make reinstall-vsix
```

The generated package is written under `.artifacts/vsix/`.

---

## Project Structure

| Path            | Contents                                              |
| --------------- | ----------------------------------------------------- |
| `src/api/`      | Gitea REST API client + TypeScript types              |
| `src/auth/`     | Token storage via VS Code `SecretStorage`             |
| `src/commands/` | Command registrations (PR, CI, Issue, Auth)           |
| `src/context/`  | Multi-repo detection using the `vscode.git` API       |
| `src/ui/`       | Status bar item                                       |
| `src/views/`    | Tree data providers + webview panels                  |
| `resources/`    | Static assets (icons, SVGs)                           |
| `package.json`  | Extension manifest (commands, views, menus, settings) |

---

## Contribution Guidelines

### Bugs & Feature Requests

- **Search existing issues** before opening a new one.
- For bugs, include: VS Code version, Gitea version, steps to reproduce, and the error message from the **Output** panel (`Gitea Pull Request` channel).
- For features, explain the use case, not just the implementation.

### Pull Requests

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`
2. Make your changes.
3. Run `make verify` before opening the PR; use `make coverage` when changing directly testable domain logic.
4. Follow the existing code style — ESLint 9 flat config + `tsc --strict`.
5. Keep the scope of changes small and focused — one feature/fix per PR.
6. Update `README.md` if you add user-facing functionality.
7. Open the PR against the `main` branch.

### Adding a New API Method

1. Add the TypeScript interface to `src/api/types.ts` if needed.
2. Add the method to `GiteaApiClient` in `src/api/giteaApiClient.ts`.
3. Call the existing request helpers appropriate to the response type and preserve the API/UI separation used by the project.

### Adding a New Command

1. Add the command `id` + `title` to `package.json` → `contributes.commands`.
2. If it appears in menus, add it to `contributes.menus`.
3. Register it with `context.subscriptions.push(vscode.commands.registerCommand(...))` inside the relevant `src/commands/*.ts` file.

---

## Logging

Use the shared `LogOutputChannel` helpers from `src/debug/outputChannel.ts` and keep component prefixes such as `[pr-session]`, `[pr-refresh]` or `[conflict-resolution]` stable enough to search.

- `trace`: high-frequency or very fine diagnostic detail;
- `debug`: orchestration, refresh/cache decisions and investigation detail;
- `info`: meaningful lifecycle or user-visible state transitions;
- `warn`: degraded/recoverable behavior that deserves attention;
- `error`: a requested operation failed or the workflow cannot continue normally.

Include useful correlation context (`repo`, PR/issue/run identifier, operation) where it helps diagnose a failure. Avoid keystroke-level logging and do not promote routine implementation chatter to `info`.

---

## Code Style

- TypeScript strict mode (`"strict": true` in `tsconfig.json`).
- Prefer native VS Code and Node.js APIs before adding runtime dependencies.
- Prefer `async/await` over `.then()` chains.
- Keep Webview CSP restrictive and escape user-controlled HTML content.
- Preserve native VS Code interaction patterns (TreeView, QuickPick, commands, context keys and Codicons) where they are sufficient.

---

## Security

- **Never** store tokens in plain text. Use `vscode.SecretStorage` (already wired in `AuthManager`).
- Treat all external/user content rendered in Webviews as untrusted.
- Do not weaken Webview Content-Security-Policy without a specific reviewed requirement.

---

## Release and compatibility baseline

For the `0.7.0` release line, the validated baseline is:

- VS Code `1.133.0+`;
- Gitea `1.26.4+`;
- Node.js `24.x` for build/test/package workflows.

See [`docs/RELEASING.md`](docs/RELEASING.md) for the release process.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
