# Phase 9.1-D — Native review actions validation

This slice makes existing native PR review threads actionable without changing the submission boundary: editor actions queue operations in the same extension-owned pending review session used by PR Detail.

## Interactive acceptance

- [ ] On a Gitea server with inline replies support, an unresolved native review thread exposes a reply box/action.
- [ ] Adding a native reply does not immediately create a Gitea reply; it appears in the shared pending review transaction and is submitted through the existing PR Detail review submission flow.
- [ ] Reopening PR Detail after queuing a native reply shows the same pending reply.
- [ ] Resolve on an unresolved native thread queues a pending resolve operation rather than calling Gitea immediately.
- [ ] Reopen on a resolved native thread queues a pending reopen operation rather than calling Gitea immediately.
- [ ] Queuing the same Resolve/Reopen action twice cancels it, preserving the existing pending-session toggle semantics.
- [ ] Queuing the opposite lifecycle action replaces the previous desired state.
- [ ] Pending Resolve/Reopen is reflected immediately by the native thread state.
- [ ] On a server without inline reply capability, the native reply box/action is absent.
- [ ] On a server without inline resolution capability, Resolve/Reopen native actions are absent.
- [ ] Existing PR Detail reply/resolve/reopen and pending submission behavior remains unchanged.
- [ ] No native action checks out or mutates the working tree.

## Deferred

Refresh/head-change rebind remains Phase 9.1-E. Previous/next unresolved navigation and file-level unresolved signal remain Phase 9.1-F.
