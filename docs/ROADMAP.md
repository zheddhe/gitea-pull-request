# Gitea Pull Request — Roadmap

## Product direction

**Gitea Pull Request** is a VS Code extension focused on a complete, sidebar-first workflow for self-hosted Gitea: pull requests, review, issues and Actions, without replacing native Git or VS Code editing workflows.

The product follows stable principles:

1. **Native first** — prefer TreeView, QuickPick, commands, Comment API, Codicons and native diffs.
2. **Sidebar first** — common forge operations should not require leaving VS Code.
3. **State driven** — workflow UI follows explicit repository / PR / review state rather than hidden assumptions.
4. **Safe local Git** — review state and local editing remain distinct; branch-changing and destructive operations are explicit and validated.
5. **Multi-instance by design** — repositories map deterministically to Gitea instances and credentials never cross instance boundaries.
6. **Capability driven** — features degrade independently according to observed API support and effective permissions.
7. **Adaptive freshness** — remote state refreshes according to visibility and activity without aggressive per-view timers.

## Current baseline

The current stable product line is **1.1.x**.

It provides:

- a dedicated active-PR workspace with authoritative snapshot review;
- native inline review conversations and pending-review continuity;
- pull-request creation, review, merge readiness and guarded branch cleanup;
- Issue browsing, detail, authoring and repository templates;
- CI / Actions runs, jobs, logs and contextual diagnostics from PR checks;
- adaptive polling shared across remote-state workflows;
- deterministic multi-repository / multi-Gitea-instance mapping;
- least-privilege PAT authentication with capability-aware degradation.

Detailed shipped behavior belongs in [`CHANGELOG.md`](../CHANGELOG.md), while release-specific validation is retained in versioned release records such as [`RELEASE_1.1.0.md`](RELEASE_1.1.0.md).

## Next directions

The roadmap deliberately describes product direction rather than committing every candidate to a specific release.

### Authentication evolution

- evaluate OAuth2 Authorization Code + PKCE without regressing first-class PAT support for arbitrary self-hosted instances;
- keep account identity, SecretStorage isolation and capability observation independent of authentication method;
- continue reducing reliance on broad credentials and improve least-privilege diagnostics.

### Review workflow

- deepen native VS Code review integration where the platform APIs provide stable primitives;
- improve navigation and lifecycle handling for long-lived or heavily updated pull requests;
- preserve one logical review/conversation model across native diff and PR Detail surfaces;
- continue reducing duplicate or context-losing transitions between review surfaces.

### CI / Actions

- expose richer execution detail only where Gitea APIs provide authoritative data;
- improve contextual transitions between PR checks, runs, jobs, logs and artifacts;
- extend capability detection for server/version differences without creating parallel CI implementations.

### Repository and forge integration

- improve discovery and diagnostics for complex self-hosted network / SSH topologies;
- keep foreign forges and ambiguous remotes isolated rather than probing them with Gitea credentials;
- expand server capability discovery as newer Gitea APIs stabilize.

### Workflow safety and ergonomics

- continue treating local Git state as safety-critical for destructive operations;
- favor explicit recovery paths over implicit reset/push/rebase behavior;
- simplify contextual actions where the target resource is already known;
- keep automatic refresh editing-safe and non-mutating.

## Release history

| Milestone | Release | Scope |
| --- | ---: | --- |
| Product foundation | `0.1.0`–`0.6.0` | Standalone product, active PR model, creation/review/merge and dedicated workspace |
| Workflow completion | `0.7.0`–`0.9.0` | Detail surfaces, conflict workflow, interactive review and Issue authoring |
| Full UX baseline | `1.0.0` | Native review, adaptive polling, Actions detail and multi-instance authentication |
| Continuity and safety | `1.1.0` | Review continuity, contextual CI diagnostics and merge/cleanup safeguards |

Patch releases remain reserved for corrections that do not introduce the next product milestone.

## Release discipline

A release is ready only when implementation, tests, user documentation and package metadata describe the same product behavior.

Before publication:

```bash
make verify
make reinstall-vsix
```

Validate the exact generated VSIX, merge the release candidate, tag the merged commit, let the release workflow rebuild the tag, then publish the verified artifact.

See [`RELEASING.md`](RELEASING.md) for the operational procedure and [`TESTING.md`](TESTING.md) for the test architecture.
