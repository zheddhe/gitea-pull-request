# Releasing Gitea Pull Request

This document describes the release path for **Gitea Pull Request** on GitHub and the Visual Studio Marketplace.

## Release identity

- Marketplace publisher display name: **Rémy Canal**
- Marketplace publisher ID: **zheddhe**
- Extension package name: **gitea-pull-request**
- Marketplace extension identity: **zheddhe.gitea-pull-request**

The repository and Marketplace publication are maintained independently from the maintainer's employer.

## Marketplace authentication

The release workflow uses **GitHub Actions OIDC trusted publishing** through `@vscode/vsce`.

No Azure DevOps Personal Access Token is required or expected by `.github/workflows/release.yml`.

Configure the Visual Studio Marketplace publisher to trust this GitHub workflow:

- GitHub owner: `zheddhe`
- Repository: `gitea-vscode-extension`
- Workflow: `.github/workflows/release.yml`
- Marketplace publisher: `zheddhe`

The workflow requests `id-token: write`, and `vsce publish --oidc` exchanges the GitHub OIDC identity for a short-lived Marketplace credential.

Do not add a long-lived Marketplace PAT to the repository unless OIDC cannot be enabled for an exceptional bootstrap case. If a PAT is ever used temporarily, store it only as a GitHub Actions secret and remove it once trusted publishing is available.

## Release gate

A phase release is promoted only after implementation and documentation are ready.

For `0.7.0`, version metadata is already promoted. The remaining local gate is:

```bash
make verify
make reinstall-vsix
```

Confirm both `package.json` and `package-lock.json` contain `0.7.0` and that the local VSIX exists at:

```text
.artifacts/vsix/gitea-pull-request-0.7.0.vsix
```

Perform the final smoke pass before merging the release PR.

## GitHub release sequence

1. Merge the validated release PR into the default branch.
2. Create tag `v<package-version>` on the merged release commit.
3. Create and publish the corresponding GitHub Release.
4. Publishing the GitHub Release triggers `.github/workflows/release.yml`.
5. The workflow checks out the release tag and validates that the tag version, package version, publisher ID and package name are coherent.
6. `make ci` performs the clean dependency install, compile, lint, tests and VSIX packaging.
7. The generated versioned VSIX is uploaded to the GitHub Release.
8. The exact same VSIX is published to the Visual Studio Marketplace with `vsce publish --oidc`.

The workflow must fail rather than publish when the release identity is inconsistent.

## Workflow requirements

The release workflow intentionally uses:

- Node.js 22;
- the project `Makefile` as the build/test/package source of truth;
- pinned `@vscode/vsce` version `3.9.2` for publication;
- GitHub permissions `contents: write` and `id-token: write`;
- one release execution per tag through GitHub Actions concurrency;
- no stored Marketplace credential.

## First Marketplace publication

Before publishing the first release, confirm in the Marketplace publisher portal that:

- publisher display name is **Rémy Canal** and publisher ID is `zheddhe`;
- the GitHub trusted-publishing policy points to the exact repository and workflow above;
- the extension name `gitea-pull-request` is available;
- Marketplace-facing README, icon, repository, support and license information are correct.

If trusted publishing is not available in the publisher portal, do not silently modify the workflow to use a token. Decide explicitly whether to perform a temporary PAT-based bootstrap publication or contact Marketplace support.

## License and origin

The repository contains inherited MIT-licensed code from `dj0024javia/gitea-vscode-extension`. `LICENSE` preserves the inherited copyright notice and adds the copyright notice for the independently maintained product line. `NOTICE` documents the project origin.

Detaching the GitHub repository from its fork network, if done later, is independent from these license and attribution obligations.
