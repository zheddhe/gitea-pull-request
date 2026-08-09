# Contributing to Gitea for VS Code

Thank you for your interest in contributing! Please read this guide before opening issues or pull requests.

---

## Development Setup

### Prerequisites

- **Node.js** 18+ (uses native `fetch`)
- **npm** 9+
- **VS Code** 1.85+
- A running Gitea instance for testing

### Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/your-org/gitea-vscode-extension
cd gitea-vscode-extension

# 2. Install dependencies
npm install

# 3. Open in VS Code
code .
```

### Running in Development Mode

Press **F5** (or `Run → Start Debugging`) to launch the Extension Development Host — a new VS Code window with the extension loaded from source.

Any TypeScript changes require recompiling:

```bash
npm run compile
# or keep a watcher running:
npm run watch
```

### Building a VSIX package

```bash
npx vsce package --no-dependencies --allow-missing-repository
```

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
- For bugs, include: VS Code version, Gitea version, steps to reproduce, and the error message from the **Output** panel (`Gitea` channel).
- For features, explain the use case, not just the implementation.

### Pull Requests

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`
2. Make your changes.
3. Run `npm run compile` to ensure there are no TypeScript errors.
4. Follow the existing code style — ESLint 9 flat config + `tsc --strict`.
5. Keep the scope of changes small and focused — one feature/fix per PR.
6. Update `README.md` if you add user-facing functionality.
7. Open the PR against the `master` branch.

### Adding a New API Method

1. Add the TypeScript interface to `src/api/types.ts` if needed.
2. Add the method to `GiteaApiClient` in `src/api/giteaApiClient.ts`.
3. Call `this.request<ReturnType>(serverUrl, '/endpoint')` for JSON responses.
4. Call `this.requestText(serverUrl, '/endpoint')` for plain-text responses (e.g. raw diffs).

### Adding a New Command

1. Add the command `id` + `title` to `package.json` → `contributes.commands`.
2. If it appears in menus, add to `contributes.menus`.
3. Register it with `context.subscriptions.push(vscode.commands.registerCommand(...))` inside the relevant `src/commands/*.ts` file.

---

## Code Style

- TypeScript strict mode (`"strict": true` in `tsconfig.json`).
- No runtime dependencies — use native VS Code APIs and Node 18 built-ins (`fetch`, etc.).
- Prefer `async/await` over `.then()` chains.
- Keep webview HTML/CSS inline (no external files) — the CSP in the webview panel restricts external resources.
- HTML in webviews uses `escHtml()` for all user-supplied content to prevent XSS.

---

## Security

- **Never** store tokens in plain text. Use `vscode.SecretStorage` (already wired in `AuthManager`).
- All user content rendered in webviews **must** go through `escHtml()`.
- The webview Content-Security-Policy is `default-src 'none'` — do not weaken it.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
