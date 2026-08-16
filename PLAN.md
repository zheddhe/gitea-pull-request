# Gitea Pull Request — Development Plan

The project is now developed as the standalone **Gitea Pull Request** extension by **zheddhe**.

The canonical transformation and implementation plan is maintained in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Current product direction

The extension is moving toward a sidebar-first pull-request experience for Gitea:

- native TreeView navigation for repositories, PR categories and changed files;
- WebviewView only for richer creation/review forms where native controls are insufficient;
- VS Code QuickPick for reviewers, assignees, labels, milestones and similar selections;
- explicit PR workspace/session state controlling contextual UI;
- native `vscode.diff` for file inspection;
- full PR detail webview retained as an alternative secondary view;
- post-merge local/remote branch cleanup as an explicit workflow step.

## Existing foundation retained

The current implementation already provides reusable foundations for:

- Gitea REST API access;
- authentication and SecretStorage;
- repository/workspace context;
- pull-request listing and category grouping;
- changed-file tree and native diff integration;
- reviews, comments and merge operations;
- issues;
- Gitea Actions / CI runs and logs.

These capabilities are migrated progressively rather than rewritten wholesale.

## Implementation phases

1. **Phase 0 — Product split and foundation**
2. **Phase 1 — Active pull-request session model**
3. **Phase 2 — Sidebar-first PR creation**
4. **Phase 3 — Sidebar-first review and merge**
5. **Phase 4 — Post-merge lifecycle and branch cleanup**
6. **Phase 5 — Secondary workflows and polish**

For detailed scope, acceptance criteria and target architecture, see [`docs/ROADMAP.md`](docs/ROADMAP.md).
