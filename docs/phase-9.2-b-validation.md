# Phase 9.2-B validation

The lifecycle signal layer is observable before polling consumers are migrated.

## Runtime checks

With the `Gitea Pull Request` output channel set to Debug, verify `[polling] lifecycle` entries while:

- focusing and unfocusing the VS Code window (`windowActive=true/false`);
- opening and hiding Create Pull Request (`visible=pull-request-create`);
- opening and hiding Review Pull Request (`visible=pull-request-review`);
- entering post-merge state (`lifecycle=post-merge`, surface `pull-request-post-merge` when visible);
- creating or removing pending inline review work (`activity=editing` then back to `idle` or `recent-action`).

No `[polling] attempt` entry is expected from 9.2-B alone: resource registrations remain deferred to 9.2-C.

## Safety

This slice only observes extension/window/session/view state. It performs no Gitea API polling and no Git working-tree mutation.
