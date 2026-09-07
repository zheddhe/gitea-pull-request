# Phase 9.3-A — Instance identity, transport resolution and credential boundary

## Scope

9.3-A hardens the mapping between local Git repositories and authenticated Gitea instances before permission diagnostics are introduced.

The slice does not add OAuth. Personal Access Tokens remain the first-class authentication mechanism for the 1.0 baseline.

## Architectural model

A Gitea instance has one canonical API/web identity and may be reachable through several Git transports.

```text
                    Gitea instance
              https://gitea.company.fr
                         |
                  credential/session
                         |
              +----------+-----------+
              |                      |
       HTTPS transport          SSH transport
 gitea.company.fr:443      git.internal:2222
                                  ^
                                  |
                           SSH alias work-git
```

Credentials, sessions and capability state are keyed only by canonical instance identity. A transport hostname is never itself a credential key unless it is also the canonical instance endpoint.

## Canonical instance identity

The canonical instance identity is the normalized configured/authenticated Gitea URL.

Normalization must preserve semantically significant elements such as non-default ports and an intentional base path, while removing equivalent formatting differences such as trailing slashes and hostname case.

Examples:

- `https://GITEA.EXAMPLE.COM/` -> `https://gitea.example.com`
- `https://gitea.example.com:8443/` -> `https://gitea.example.com:8443`
- `https://gitea.example.com/gitea/` -> `https://gitea.example.com/gitea`

`https://forge.local` and `https://forge.local:8443` are different instance identities.

## Repository-to-instance resolution

Resolution follows evidence from strongest/most standard to explicit fallback:

1. Read the repository remote selected by the extension (`origin`, otherwise the first remote).
2. Resolve Git URL rewriting using the repository's effective Git configuration (`insteadOf` / `pushInsteadOf`) rather than reimplementing Git config semantics.
3. Parse HTTPS, `ssh://` and SCP-like SSH remote syntaxes structurally.
4. For SSH transports, resolve OpenSSH effective configuration (equivalent to `ssh -G`) so `Host`, `HostName`, `Port`, `User`, includes and match rules are honored by the local SSH implementation.
5. Match the resulting transport identity against configured/authenticated Gitea instances.
6. If standard resolution cannot establish the association, use an explicit configured transport mapping attached to one Gitea instance.
7. Keep well-known public non-Gitea forges excluded from implicit Gitea classification unless explicitly configured as a Gitea endpoint.
8. If no unique association can be established, leave the repository unmapped.

Discovery must never send a PAT to arbitrary hosts in order to probe whether they are Gitea.

## Supported remote forms

The parser/resolver must cover at least:

- `https://gitea.example.com/org/repo.git`
- `https://gitea.example.com:8443/org/repo.git`
- `git@gitea.example.com:org/repo.git`
- `git@ssh-alias:org/repo.git`
- `ssh://git@gitea.example.com/org/repo.git`
- `ssh://git@gitea.example.com:2222/org/repo.git`
- IP-address based on-premise SSH/HTTPS endpoints.

Owner/repository extraction must remain independent from the API endpoint mapping.

## Explicit transport mappings

`gitea.servers` remains the primary configuration surface. A server may optionally declare transport endpoints only when Git/OpenSSH resolution cannot naturally associate the remote with the API URL.

Target shape:

```json
{
  "gitea.servers": [
    {
      "url": "https://gitea.company.example",
      "label": "Company Gitea",
      "transports": [
        {
          "host": "git.internal.local",
          "port": 2222
        }
      ]
    }
  ]
}
```

The configuration intentionally uses `transports`, not an untyped `aliases` list. Host and port describe transport identity explicitly and avoid mixing DNS aliases, SSH aliases, API URLs and arbitrary strings.

A raw SSH alias may also be considered during matching, but OpenSSH effective resolution is preferred so users do not normally need to duplicate `~/.ssh/config` in VS Code settings.

## Legacy global override

`gitea.serverUrl` currently acts as a global override and can reinterpret unrelated repository remotes as one Gitea instance. This conflicts with deterministic multi-instance mapping.

For 1.0:

- existing configuration must not be broken silently;
- the setting should no longer be the normal repository classification mechanism;
- explicit `gitea.servers[].transports` is the replacement for legitimate split SSH/API-host cases;
- the global override should be treated as a compatibility/deprecation path and must never defeat known non-Gitea forge exclusion.

## Status bar consequence

Repository detection is reactive to VS Code Git repository/open-close/state/configuration events. Once mapping is deterministic, repository re-scan is a recovery/diagnostic action rather than a primary status-bar interaction.

Target behavior:

- remove repository switch/re-scan as the persistent status-bar affordance;
- keep a `Gitea: Re-scan Repositories` command available for recovery/diagnostics;
- make the persistent Gitea status item represent authentication/account state;
- clicking the auth item opens account management rather than immediately signing out;
- one instance may display `user @ host`; multiple authenticated instances may display an account count;
- the account model includes an auth-method discriminator (`PAT` now, `OAuth` later) without making OAuth a 1.0 requirement.

## Security invariants

1. A credential is stored only in VS Code SecretStorage.
2. Credential/session/cache keys include canonical Gitea instance identity.
3. Repository transport identity is never used to retrieve another instance's credential unless it has been deterministically mapped to that canonical instance.
4. A failed or ambiguous mapping produces `unmapped`, not credential probing.
5. Sign-out/token replacement affects only the selected canonical instance and dependent state.
6. Logs may include canonical instance and sanitized transport identity but never PAT or Authorization header material.

## Test matrix for 9.3-A

Unit/integration coverage should include:

- canonical URL normalization, including hostname case, trailing slash, default and custom ports;
- HTTPS remote classification;
- SCP-like SSH classification;
- `ssh://` syntax with and without custom ports;
- SSH alias effective host/port resolution;
- Git `insteadOf` effective URL resolution;
- explicit transport mapping for split Git/API hostnames;
- multiple Gitea instances with overlapping repository names;
- known GitHub/GitLab/Bitbucket/Azure exclusion;
- unknown/unmatched hosts remain unmapped;
- repository list equality remains independent of detection order;
- no cross-instance credential/session selection.

## Deferred to later 9.3 slices

- typed authentication vs authorization API errors;
- observed capability registry;
- capability-specific UX degradation;
- PAT permission recipe/onboarding UI;
- account diagnostics UI beyond the status-bar/account-management entry point;
- OAuth2 Authorization Code + PKCE.
