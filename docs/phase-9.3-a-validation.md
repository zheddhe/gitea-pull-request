# Phase 9.3-A — Runtime validation

## Automated validation

GitHub Actions CI run `34205822911` is green on head `4d2945a7468272090d5442fe72362d4c59baaf6e`.

Validated automatically:

- TypeScript compilation;
- lint baseline;
- VS Code test suite, including new instance/transport resolver cases;
- direct coverage generation;
- extension bundling and VSIX packaging.

## Runtime validation required before merge

9.3-A changes repository-to-instance discovery and account/status-bar behavior. The following scenarios must be exercised in an Extension Development Host or installed VSIX before the PR leaves draft.

### A. Existing PAT compatibility

1. Start from a profile already signed in with the pre-9.3 extension.
2. Activate the 9.3 build.
3. Confirm the existing account remains authenticated without asking for a replacement PAT.
4. Confirm PR / Issue / CI data still loads.
5. Confirm no token material appears in logs.

Expected: legacy account/SecretStorage keys are migrated to the canonical instance URL transparently.

### B. Direct HTTPS instance

Remote example:

```text
https://gitea.example.com/org/repo.git
```

Expected:

- repository is detected after signing in/configuring `https://gitea.example.com`;
- repository maps to exactly that instance;
- status bar shows the authenticated account, not a repository selector;
- unknown unrelated repositories stay outside the Gitea views.

### C. HTTPS custom port

Remote example:

```text
https://gitea.example.com:8443/org/repo.git
```

Instance:

```text
https://gitea.example.com:8443
```

Expected: the custom port is part of canonical identity and is not collapsed onto `https://gitea.example.com`.

### D. SSH alias resolved by OpenSSH

`~/.ssh/config` example:

```sshconfig
Host work-gitea
    HostName gitea.example.com
    Port 2222
    User git
```

Remote:

```text
git@work-gitea:org/repo.git
```

Expected:

- `ssh -G` resolves the alias to the effective host/port/user;
- the repository maps to `https://gitea.example.com` without a duplicated VS Code alias setting;
- no PAT is sent to `work-gitea` or to the SSH endpoint during discovery.

### E. Explicit split Git/API endpoint

Git transport:

```text
ssh://git@git.internal.local:2222/org/repo.git
```

Gitea API/web endpoint:

```text
https://gitea.company.example
```

Configuration target:

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

Expected: the repository is mapped to the canonical API instance through the explicit transport mapping.

### F. Mixed-forge workspace

Open a workspace containing at least:

- one repository on the authenticated Gitea instance;
- one GitHub repository;
- optionally one GitLab / Bitbucket / Azure DevOps repository.

Expected: public non-Gitea forge repositories are not captured by the Gitea extension, including when legacy `gitea.serverUrl` is still configured.

### G. Unknown private remote

Remote example:

```text
git@unknown.internal:org/repo.git
```

with no matching Gitea instance or explicit transport mapping.

Expected: repository remains unmapped. The extension must not try candidate PATs against that host.

### H. Multi-instance isolation

Authenticate to two Gitea instances and open repositories with the same `owner/repo` name on both.

Expected:

- both repositories remain distinct because `RepoInfo.key` includes canonical instance identity;
- sign-out / PAT replacement on instance A does not remove the session for instance B;
- after sign-out from A, repositories mapped only to A disappear from Gitea views while B remains operational.

### I. Status-bar account management

Expected:

- signed out: `Sign in to Gitea`;
- one account: `user @ host`;
- multiple instances: account count;
- click opens account management;
- account action supports PAT replacement or sign-out for that instance only;
- repository re-scan remains available as a recovery action rather than a persistent repository selector.

## Known UI/schema follow-up before 9.3 completion

The runtime resolver already consumes optional `gitea.servers[].transports`, but the contributed VS Code configuration schema/Command Palette labels still need to be aligned with the new contract before 9.3 is complete. This does not block resolver runtime validation, but it must be closed before final merge of the story.
