# Changelog

All notable changes to the Gitea VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-08-07

### Changed

- **Rebranded** extension as `gitea-vscode-pullrequest-enhanced` (displayName: "Gitea for VS Code — Enhanced") for iterative improvements before upstream contributions
- Switched to extension naming convention for easier iteration on issues

### Fixed

- **PR creation hang**: progress notification now dismisses immediately after API response — applies to create, merge, review, and comment actions
- **PR review submission**: restored full authentication error messages with sign-in guidance
- Factored duplicate `addEventListener` calls into a single message handler for review submission
- Added `DOM` lib to `tsconfig.json` for proper webview type support
- **ESLint 9 flat config**: completed migration with `@typescript-eslint/parser`, explicit TypeScript file patterns, Node.js/Mocha globals, and TypeScript-aware rule overrides

### Chores

- Migrated dev dependencies to resolve 12 npm audit vulnerabilities:
  - `eslint` 8 → 9 with flat config (`eslint.config.js`), removed legacy `.eslintrc.json`
  - `@typescript-eslint` 6 → 8
  - `mocha` 10 → 11
  - Removed unused `node-fetch` (native `fetch` on Node 20+)
  - Added overrides for `diff`, `serialize-javascript`, and `glob`

## [7.0.0] - 2026-08-08

### Added

- **Navigable PR diff tree view** — dedicated `PR Diff` panel in the Gitea sidebar, mirroring the GitHub PR extension layout
  - `CHANGES IN PULL REQUEST #N` header with branch info and file stats
  - Collapsible file directory tree with status icons (A/D/M) and +/- counts
  - Checkbox tracking per file, directory, and section — mark files as reviewed with propagation to parent nodes
  - Click any file to open VS Code's native `vscode.diff` editor (base branch vs head branch)
  - Commits and Reviews sections with proper icons and state colors
  - Automatic refresh when switching between PRs
- **`getFileContents()` API method** — fetches file content from a specific branch via Gitea contents API

### Changed

- **PR list diff stats** now clickable — opens the PR Diff panel instead of showing `+? / -?`
- Version bumped to `7.0.0` to reflect the major addition of the PR diff tree view
- Fork version tracking: `7.0.0-fork1.0.0` (subsequent releases will use `7.0.0-fork1.X.X`)

### Fixed

- Diff stats in the PR list now show real values (`+0 / -0 0 file(s) changed`) instead of `+? / -?`

## [0.6.0] - 2026-03-12

### Added

- **Manual refresh controls**: inline refresh buttons on repository groups and individual CI jobs in the tree view
- **New API method**: `getWorkflowJob` to fetch single job details from Gitea Actions API
- **Enhanced CI detail panel**: animated spinner for running steps, `⚡ EXECUTING` labels, colored status badges (green/yellow/red)

### Changed

- **Auto-polling disabled** in the CI tree view — replaced by manual refresh commands (`gitea.refreshRepo`, `gitea.refreshJob`)
- **Jobs are no longer expandable** in the tree view since Gitea API does not expose step-level details
- Added support for additional Gitea workflow status values: `in_progress`, `completed`, `failed`
- `steps` field on `GiteaWorkflowJob` is now optional to match real API responses
- Silent refresh mode for background updates without loading indicators

### Fixed

- Step rendering in the CI detail panel now correctly handles `in_progress` and `completed` statuses
- Status icons and badges now cover all Gitea status variants (`in_progress`, `completed`, `failed`)
- Job tooltips clarify that step-level details are not available via the Gitea API

## [0.5.0] - 2026-03-12

### Added

#### 🎉 Live CI/Actions Updates

- **Live status polling**: Tree view automatically refreshes every 5 seconds when workflows are running
- **Live indicators**: Running jobs show 🔴 indicator in descriptions and tooltips
- **Smart polling**: Only refreshes repositories with active/running workflows to minimize API calls

#### 📊 Live Log Streaming

- **New live log viewer**: Dedicated webview panel that streams job logs in real-time
- **Auto-scroll to bottom**: Automatically scrolls to end as new logs arrive
- **Smart scroll behavior**: Pauses auto-scroll if user scrolls up manually, resumes when scrolling to bottom
- **Live status updates**: Job status changes reflected in real-time with emoji indicators (⏳ → ✅/❌)
- **Streaming indicator**: Shows pulsing green "Live streaming" badge while logs are active
- **2-second refresh**: Polls for new log content every 2 seconds while job is running

#### ⏱️ Duration & Timing Information

- **Run duration**: Shows total elapsed time for workflow runs
- **Job duration**: Each job displays execution time in ⏱️ format
- **Step duration**: Individual steps show their execution time
- **Live updates**: Duration updates automatically for running jobs

#### 🔄 Enhanced CI Detail Panel

- **Auto-refresh**: Detail panel polls every 3 seconds while workflows are running
- **Live status badge**: Shows pulsing "Live" indicator when workflow is in progress
- **Better log access**: Click "📋 Logs" on any job to open live log viewer
- **Duration tracking**: Displays elapsed time at all levels (run, job, step)

### Changed

- Tree view items now start **collapsed by default** instead of expanded
- All tree items have unique IDs to **persist expand/collapse state** across sessions
- Tree state is remembered when switching between extensions
- Improved resource efficiency with smart polling that stops when all jobs complete

### Fixed

- Tree view state now persists correctly when navigating to other extensions
- Proper cleanup of polling timers and resources on disposal
- Better error handling during live streaming

## [0.4.0] - 2026-03-10

### Added

- Initial release with Pull Requests, Issues, and CI/Actions support
- Multi-repository detection with submodules
- Inline code review with GitHub-style diff viewer
- Merge, approve, and comment on pull requests
- View and manage workflow runs and jobs
- Status bar integration

### Features

- Pull Request management
- Issue tracking
- CI/Actions workflow viewing
- Repository context detection
- Authentication via Gitea API tokens

[0.6.1]: https://github.com/dj0024javia/gitea-vscode-extension/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/dj0024javia/gitea-vscode-extension/compare/v0.5.1...v0.6.0
[0.5.0]: https://github.com/dj0024javia/gitea-vscode-extension/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dj0024javia/gitea-vscode-extension/releases/tag/v0.4.0
