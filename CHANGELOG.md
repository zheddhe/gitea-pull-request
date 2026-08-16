# Changelog

All notable changes to **Gitea Pull Request** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- Standalone **Gitea Pull Request** product identity and transformation roadmap.
- Pull-request workspace/session state foundation with VS Code context-key synchronization.
- Baseline tests for PR session state transitions.
- Reproducible Make-based development workflow for clean builds, validation, VSIX packaging and local installation.
- Canonical disposable local package output under `.artifacts/vsix/`.

### Changed

- CI uses the same Make-based clean build/test/package path as local development.
- CI build runtime moves to Node.js 22 to match the pinned `@vscode/vsce` packaging tool.

## Historical fork releases

The entries below describe the history inherited from the earlier Gitea VS Code extension/fork before the standalone `0.1.0` product line.

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
