# Changelog

All notable changes to the Gitea VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.0-fork1.0.0] - 2026-08-10

### Added

- **PR diff tree view** — dedicated `Changes in Pull Request` sidebar panel with directory tree, native file icons, checkbox tracking, and `vscode.diff` editor on click
- **`getFileContents()` API method** — fetch file content from a specific branch
- Clickable diff stats in the PR list — opens the PR Diff panel
- **Unified PR/Issue detail panels** — full-width tabbed layout (Details, Reviews, Commits for PR; Details, History for Issue)
- **Inline edit form** — global overlay above tabs to edit title, body, and base branch (PR) / title + body (Issue)
- **Merge status icon** — colored icon (green/yellow/red) in the title row showing latest review status
- **PR category folders** — sidebar sub-folders: All Open, Waiting for my review, Created by me
- **`updateIssue()` API method** — PATCH `/repos/{owner}/{repo}/issues/{number}`
- **Output channel** — debug logging for webview troubleshooting

### Changed

- Rebranded as `gitea-vscode-pullrequest-enhanced` with publisher `zheddhe`
- **PR sidebar icons** — colored by review status: yellow (pending), green (approved/merged), red (changes requested/closed)
- **Edit form** — moved above tabs, visible from any tab, auto-hides after Save
- **PR diff tree** — native file icons via `resourceUri`, full expand support, approval coloring
- **Consistent button colors**: blue (edit/open/refresh), green (approve/merge/reopen), red (close/request-changes)
- Dev dependencies upgraded: eslint 8→9 (flat config), @typescript-eslint 6→8, mocha 10→11, removed unused `node-fetch`

### Fixed

- Progress notifications dismiss immediately after API response (create, merge, review, comment)
- PR review submission shows full authentication error messages
- `gitea.openPRDiff` accepts `PullRequestItem` from context menus
- Checkbox state persists across re-opens; provider refreshes on PR switch
- Diff stats show real values instead of `+? / -?`
- Webview script safety — nested renderer helpers, string concatenation for script injection
- Removed non-existent `view-mode` reference in issue edit form
- Tidy issue detail labels and aligned PR icon colors with sidebar

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

[7.0.0-fork1.0.0]: https://github.com/zheddhe/gitea-vscode-extension/compare/v0.6.0...v7.0.0-fork1.0.0
[0.6.0]: https://github.com/zheddhe/gitea-vscode-extension/compare/v0.5.1...v0.6.0
[0.5.0]: https://github.com/zheddhe/gitea-vscode-extension/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/zheddhe/gitea-vscode-extension/releases/tag/v0.4.0
