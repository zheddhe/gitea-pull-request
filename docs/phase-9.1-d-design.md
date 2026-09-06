# Phase 9.1-D — Native review action contract

Native editor actions are a projection of the existing review transaction, not a second submission path.

- Reply uses VS Code `CommentReply` and queues a `PendingReviewReply` through `gitea.queuePendingReviewReply`.
- Resolve/Reopen queue a `PendingConversationAction` through `gitea.queuePendingConversationAction`.
- The existing pending-session toggle semantics remain authoritative: same lifecycle action cancels; opposite action replaces.
- Gitea capabilities are loaded once for the active projection snapshot. Reply and lifecycle actions are hidden/disabled when unsupported.
- No native action invokes Gitea mutation endpoints directly.
- Existing PR Detail submission remains responsible for applying and reconciling the combined pending transaction.
- Snapshot documents stay read-only; no action checks out or mutates a working branch.

Phase 9.1-E owns refresh/head-change rebind semantics. Phase 9.1-F owns unresolved navigation and file-level signal.
