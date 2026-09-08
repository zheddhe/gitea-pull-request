# Gitea Pull Request — Roadmap

## Product direction

**Gitea Pull Request** is a VS Code extension focused on a complete, sidebar-first workflow for self-hosted Gitea: pull requests, review, issues and Actions, without replacing native Git or VS Code editing workflows.

The product follows a few stable principles:

1. **Native first** — prefer TreeView, QuickPick, commands, Comment API, Codicons and native diffs.
2. **Sidebar first** — common forge operations should not require leaving VS Code.
3. **State driven** — workflow UI follows explicit repository / PR / review state rather than hidden assumptions.
4. **Safe local Git** — review state and local editing remain distinct; branch-changing operations are explicit and validated.
5. **Multi-instance by design** — repositories map deterministically to Gitea instances and credentials never cross instance boundaries.
6. **Capability driven** — features degrade independently according to observed API support and effective permissions.
7. **Adaptive freshness** — remote state refreshes according to visibility and activity without aggressive per-view timers.

## Release milestones

| Phase | Product milestone | Release |
| --- | --- | ---: |
| 0 | Product split and foundation | `0.1.0` |
| 1 | Active pull-request model | `0.2.0` |
| 2 | Sidebar-first PR creation | `0.3.0` |
| 3 | Sidebar-first review and merge | `0.4.0` |
| 4 | Post-merge branch lifecycle | `0.5.0` |
| 5 | Dedicated Pull Request workspace | `0.6.0` |
| 6 | Secondary workflows and polish | `0.7.0` |
| 7 | Workflow completion and refresh hardening | `0.8.0` |
| 8 | Interactive review and first-class Issue authoring | `0.9.0` |
| 9 | Full state-of-the-art UX baseline | `1.0.0` |

Patch versions are reserved for corrections that do not introduce the next product milestone.

## Phase 9 — 1.0.0

Phase 9 turns the mature 0.9 feature set into the first complete 1.0 user experience.

### Native review experience

- native VS Code review conversations project the existing pending-review transaction rather than creating a second mutation path;
- Reply, Resolve and Reopen remain capability-gated and participate in the same submit/reconcile workflow as PR Detail;
- unresolved review navigation and review-state presentation stay bound to the authoritative PR snapshot.

### Adaptive polling

- one centralized scheduler replaces independent feature timers;
- cadence adapts to visibility, VS Code focus, active workflow state, recent user actions and unchanged-result backoff;
- editing pauses automatic refresh where it could disrupt user input;
- polling callbacks refresh remote data only and never mutate the Git working tree.

### Authentication and least privilege

- PAT remains the first-class authentication method for 1.0, especially for arbitrary self-hosted Gitea instances;
- credentials are stored only in VS Code SecretStorage and isolated by canonical Gitea instance identity;
- HTTPS, canonical SSH, SCP-style SSH, custom ports and OpenSSH aliases are resolved before repository-to-instance mapping;
- explicit `gitea.servers[].transports` mappings cover installations where Git transport and Gitea web/API endpoints intentionally differ;
- 401 authentication failures are distinguished from 403 authorization failures;
- observed capabilities are tracked independently for identity, repository, issues and Actions;
- account diagnostics expose instance, auth method and observed capabilities without exposing credentials;
- least-privilege PAT guidance is documented in [`AUTHENTICATION.md`](AUTHENTICATION.md).

OAuth2 Authorization Code + PKCE is intentionally deferred beyond the 1.0 acceptance gate. The account model already leaves room for additional authentication methods later without changing repository-to-instance identity.

### Actions experience

- workflow/job detail is based on reliable Gitea API data rather than invented step structure;
- run/job actions remain owned by the correct resource;
- artifacts and execution detail are surfaced where the server API supports them;
- unsupported server behavior degrades locally rather than disabling unrelated extension features.

## Compatibility baseline

The established baseline remains:

- **VS Code:** 1.133.0 or later
- **Gitea:** 1.26.4 or later
- **Gitea 1.27+:** required for inline review Reply support
- **Build / CI:** Node.js 24.x

Newer-server capabilities remain gated so the rest of the extension stays usable on supported older Gitea versions.

## Release gate

A milestone is ready only when implementation, tests, user documentation and package metadata describe the same product behavior.

Before release:

```bash
make verify
make reinstall-vsix
```

Validate the exact generated VSIX, merge the release candidate, tag the merged commit, publish the GitHub Release, and upload that same verified VSIX to the Visual Studio Marketplace.

See [`RELEASING.md`](RELEASING.md) for the operational release procedure and [`TESTING.md`](TESTING.md) for test architecture.

## After 1.0

Post-1.0 work should be incremental rather than another structural rewrite. Candidate areas include OAuth2/PKCE, additional server capability discovery, richer Actions detail where Gitea APIs permit it, and further native VS Code review integration.