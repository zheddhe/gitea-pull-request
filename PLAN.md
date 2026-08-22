# Gitea Pull Request — Development Plan

The project is developed as the standalone **Gitea Pull Request** extension by **zheddhe**.

The canonical transformation roadmap is maintained in [`docs/ROADMAP.md`](docs/ROADMAP.md). Active Phase 7 implementation notes are maintained incrementally in [`docs/PHASE_7.md`](docs/PHASE_7.md) and will be consolidated into the roadmap/README/release documentation when the full phase is complete.

## Current product direction

The extension is moving toward a sidebar-first pull-request experience for Gitea:

- native TreeView navigation for repositories, PR categories and changed files;
- WebviewView only for richer creation/review forms where native controls are insufficient;
- VS Code QuickPick for reviewers, assignees, labels, milestones and similar selections;
- explicit PR workspace/session state controlling contextual UI;
- native `vscode.diff` for file inspection;
- full PR detail webview retained as an alternative secondary view;
- post-merge local/remote branch cleanup as an explicit workflow step;
- compact, semantically meaningful Activity Bar signals and actions;
- structured extension diagnostics through the VS Code logging infrastructure.

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

1. **Phase 0 — Product split and foundation** (`0.1.0`)
2. **Phase 1 — Active pull-request session model** (`0.2.0`)
3. **Phase 2 — Sidebar-first PR creation** (`0.3.0`)
4. **Phase 3 — Sidebar-first review and merge** (`0.4.0`)
5. **Phase 4 — Post-merge lifecycle and branch cleanup** (`0.5.0`)
6. **Phase 5 — Dedicated Pull Request workspace** (`0.6.0`)
7. **Phase 6 — Secondary workflows and polish** (`0.7.0`)
8. **Phase 7 — Workflow completion and ergonomic hardening** (`0.8.0`, in progress)

For the stable transformation history, see [`docs/ROADMAP.md`](docs/ROADMAP.md). For the current Phase 7 implementation record and validation notes, see [`docs/PHASE_7.md`](docs/PHASE_7.md).
