# Gitea Pull Request

**Pull requests, reviews, issues and CI context for self-hosted Gitea, directly in Visual Studio Code.**

Gitea Pull Request provides a sidebar-first workflow for day-to-day Gitea work without trying to replace VS Code itself. Browse forge activity in the general **Gitea** workspace, then move into a dedicated **Gitea Pull Request** workspace when a pull request becomes active.

![Gitea workspace with pull requests, issues and CI runs](resources/screenshots/gitea-workspace.png)

## Why Gitea Pull Request?

- **Stay in VS Code** for the common pull-request lifecycle: discover, inspect, review, check readiness, merge and clean up branches.
- **Keep workflow state visible** through native TreeViews, status signals, inline row actions and focused detail panels.
- **Use Gitea CI context where it matters**: browse workflow runs/jobs globally and see PR checks directly in the review workflow.
- **Handle real merge conflicts safely** by preparing the correct local Git state and handing conflicts to native VS Code Source Control / Merge Editor.
- **Work across multiple repositories and forges** without taking ownership of GitHub, GitLab, Bitbucket or Azure DevOps repositories.

## Two workspaces, one workflow

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

The general **Gitea** workspace is the forge browser. Pull requests are grouped by repository and useful queues such as **All Open**, **Waiting for my review** and **Created by me**. Issues expose the current Open/Closed scope plus **Assigned to Me**, and CI / Actions shows recent workflow runs and jobs.

Activating a pull request opens the contextual **Gitea Pull Request** workspace. That workspace follows the active PR through review, merge readiness, conflict handling and post-merge cleanup.

## Review a pull request in context

![Pull request review with diff, checks and merge readiness](resources/screenshots/pull-request-review.png)

The review workspace brings the relevant decision points together:

- source and base branch identification;
- native changed-file navigation and VS Code diff integration;
- Approve / Request Changes review actions;
- PR checks and their current result;
- effective review state and merge readiness;
- repository-supported merge method selection;
- Merge / Close actions when appropriate.

Review state is based on each reviewer's latest effective decision. A newer **Request Changes** therefore supersedes an older approval from the same reviewer, and the Changes tree uses the same effective state as Merge Readiness.

The Create and Review views preserve unsent form text and selections when switching Activity Bar context. Remote PR/CI state can still refresh without turning Refresh into an accidental save button.

## Guided conflict resolution

When Gitea reports that a pull request is not mergeable, the extension can prepare a safe local conflict-resolution workflow instead of leaving the user at a dead end.

It verifies a clean working tree, resolves the exact PR source/base remotes, validates the expected PR head, fetches fresh refs, checks out or fast-forwards the source branch safely, and merges the fresh remote base into it. If real conflicts remain, VS Code's native Source Control / Merge Editor takes over. **Abort Merge** uses normal Git merge-abort semantics.

Conflict guidance is CI-aware: a genuinely pending check suppresses premature conflict prompting until checks settle.

## Finish cleanly after merge

![Post-merge branch workflow](resources/screenshots/post-merge-workflow.png)

After a successful merge, the extension keeps the repository/branch context long enough to offer three explicit next steps:

- **✓ Checkout Base / Delete Source** — recommended cleanup path;
- **Checkout Base / Keep Source**;
- **Create New Pull Request**.

Cleanup resolves local and remote branch identity independently, checks out the real base before deleting a checked-out source branch, and reports partial failures rather than hiding them.

## Pull request details

For inspection that needs more room than the sidebar, PR Detail provides:

- **Inline Reviews** — changed files, inline diff and submitted/pending inline comments;
- **Review History** — chronological approval/request-changes/comment events;
- **Discussion** — Markdown PR description and top-level comments;
- **Commits** — PR commit history.

Titles, descriptions and discussion comments can be edited inline. The sidebar remains the action-oriented workflow surface; PR Detail focuses on inspection and discussion.

## Issues

Issues stay in the general Gitea workspace and support:

- Open / Closed filtering;
- **Assigned to Me** aggregation;
- inline **View Details**, **Open in Browser**, **Add Comment** and contextual **Close / Re-open** actions;
- Markdown detail rendering;
- inline title, description and comment editing;
- issue creation and comment creation.

## CI / Actions

The CI / Actions tree exposes workflow runs and their jobs with meaningful final states instead of a generic `completed` label.

Run-level actions are kept at run level: **Open in Browser**, **Re-run Workflow**, and **Cancel Run** when the run is active. Job rows expose **View Logs** and **Re-run Job** where supported by Gitea.

Job Logs uses a compact detail view with status, run/job/runner metadata, Refresh and Browser actions, plus the aggregated execution log returned by Gitea. It does not invent step-level UI when the server API cannot provide reliable step detail.

PR-specific checks are also shown directly in the contextual Review view.

## Multi-repository and multi-forge workspaces

Repository discovery is scoped to configured/authenticated Gitea endpoints. Public GitHub, GitLab, Bitbucket and Azure DevOps remotes are excluded from implicit Gitea detection, allowing their own VS Code integrations to coexist in the same workspace.

The extension uses two Gitea-specific Activity Bar identities so the general forge browser and active PR lifecycle remain visually distinct from the official GitHub Pull Requests extension.

## Getting started

### Requirements

- VS Code **1.133.0** or later
- Gitea **1.26.4** or later
- a Gitea API token with the permissions required for the operations you intend to use

### Sign in

Run **`Gitea: Sign In`** from the Command Palette, then provide your Gitea server URL and API token.

Recommended permissions for the full workflow:

| Permission | Level | Purpose |
| --- | --- | --- |
| **Repository** | Read & Write | Browse, review and merge pull requests |
| **Issue** | Read & Write | Browse and manage issues |
| **Misc** | Read | Transversal API operations |
| **User** | Read | Identity/profile lookup |

Read-only usage can use narrower permissions. Write operations naturally require the corresponding Gitea permission.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gitea.serverUrl` | `""` | Override the detected Gitea web/API hostname |
| `gitea.itemsPerPage` | `20` | Pull request / CI items per page |
| `gitea.reviewsPerPage` | `20` | Reviews per page |

`gitea.serverUrl` is useful when the Git remote hostname differs from the Gitea web/API hostname, for example an SSH alias pointing at an HTTPS Gitea instance.

## Project documentation

The README is intentionally focused on using the extension. Maintainer and project-process documentation lives separately:

- [Contributing](CONTRIBUTING.md) — development setup, validation, logging and contribution conventions
- [Testing](docs/TESTING.md) — test layers and informational coverage baseline
- [Releasing](docs/RELEASING.md) — packaging and release workflow
- [Roadmap](docs/ROADMAP.md) — product evolution and completed phases
- [Changelog](CHANGELOG.md) — user-facing changes by release

## Project origin

Gitea Pull Request is an independent product/version line originating from an earlier MIT-licensed Gitea VS Code extension codebase and a short-lived enhanced fork. Inherited attribution remains preserved in the repository license/history and [NOTICE](NOTICE).

## License

[MIT](LICENSE)
