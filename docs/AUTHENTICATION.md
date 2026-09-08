# Authentication and least privilege

Gitea Pull Request 1.0 keeps Personal Access Tokens (PATs) as a first-class authentication method for self-hosted Gitea. OAuth is deliberately not required for 1.0.0.

## Recommended PAT scopes

Use the narrowest scopes that match the workflows you intend to use.

### Full extension workflow

Create a PAT with:

- `read:user`
- `write:repository`
- `write:issue`

`write:repository` includes the repository-family GET routes needed to browse repositories, pull requests, reviews and Actions, while also allowing repository-family write operations such as reviews, merges and workflow actions.

`write:issue` includes issue-family reads and writes.

### Read-only workflow

For browsing without mutations, use:

- `read:user`
- `read:repository`
- `read:issue`

Do not grant `all` merely for convenience. `read:misc` is not required by Gitea Pull Request.

## Scope is not repository authorization

A PAT scope allows access to an API route family; it does not elevate the permissions of the Gitea account that owns the token.

For example, a token may contain `write:repository` while the user itself has only read access to a repository. Gitea remains authoritative and the write operation will be rejected.

For that reason, the extension does not infer effective permissions solely from PAT scopes. It records capabilities from real API outcomes.

Observed capability states are:

- `unknown` — not conclusively exercised yet;
- `verified` — a real operation succeeded;
- `denied` — Gitea returned an authorization failure for that capability;
- `unsupported` — a feature-specific endpoint is not available on the connected Gitea instance.

A denied capability does not disable unrelated capabilities. A PAT that can read Issues but cannot read repositories therefore remains usable for the functionality Gitea still authorizes.

## Authentication diagnostics

Click the Gitea account item in the VS Code status bar and choose the relevant account, then **Authentication diagnostics**.

Diagnostics display:

- canonical Gitea instance URL;
- account name;
- authentication method (`PAT` for 1.0.0);
- observed capability states.

The diagnostic probe performs safe read operations only. It does not create an Issue, submit a review, merge a pull request or re-run a workflow merely to test a write permission. Write capabilities therefore remain `unknown` until a real user-requested write operation exercises them.

No PAT value is displayed by diagnostics.

## 401 vs 403

The extension distinguishes authentication from authorization:

- `401 Unauthorized` means the credential is invalid, expired or revoked;
- `403 Forbidden` means the credential was accepted but the requested operation is not authorized, for example because a PAT scope or repository permission is missing.

A `403` is local to the capability that failed. It does not sign the account out and does not invalidate other working features.

Server-provided error details are sanitized before they are surfaced. Authorization/token material is redacted from diagnostic messages and logs.

## Multiple Gitea instances

Credentials are isolated by canonical Gitea instance identity and stored only in VS Code SecretStorage.

Signing out of, or replacing the PAT for, one instance affects only that instance. Runtime capability observations for that instance are reset so the replacement credential can be observed from a clean state.

Repository discovery can map multiple repositories in one workspace to multiple Gitea instances.

## Git and SSH transport resolution

The API instance identity and the Git transport identity are intentionally separate concepts.

For example, one Gitea instance may be:

```text
https://gitea.company.example
```

while Git reaches it through:

```text
git@company-forge:team/project.git
```

where `company-forge` is defined in `~/.ssh/config` with a custom port.

Repository discovery resolves, in order:

1. the effective Git remote (`git remote get-url`), including Git URL rewrites;
2. HTTPS, SSH URI and SCP-like Git remote syntax;
3. effective OpenSSH configuration (`ssh -G`), including SSH aliases and custom ports;
4. configured Gitea instances;
5. optional explicit transport mappings when the Git endpoint and API endpoint cannot be derived from each other safely.

Unknown or ambiguous transports remain unmapped. The extension never sends an existing PAT to an arbitrary host merely to probe whether it might be Gitea.

### Explicit transport mapping

A mapping is only needed when the resolved Git transport endpoint differs from the Gitea web/API endpoint in a way that Git/OpenSSH configuration cannot establish automatically.

Conceptually:

```json
{
  "gitea.servers": [
    {
      "url": "https://gitea.company.example",
      "transports": [
        {
          "host": "git.internal.company",
          "port": 2222
        }
      ]
    }
  ]
}
```

Credentials remain attached to `https://gitea.company.example`, not to `git.internal.company:2222`.

## OAuth roadmap

OAuth2 Authorization Code + PKCE is a future authentication option, targeted after the 1.0.0 baseline. It will fit the same instance/account/capability model without requiring existing PAT users to migrate.
