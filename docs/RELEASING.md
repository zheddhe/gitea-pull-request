# Releasing Gitea Pull Request

This document describes the release path for **Gitea Pull Request** on GitHub and the Visual Studio Marketplace.

## Release identity

- Marketplace publisher display name: **Rémy Canal**
- Marketplace publisher ID: **zheddhe**
- Extension package name: **gitea-pull-request**
- Marketplace extension identity: **zheddhe.gitea-pull-request**
- GitHub repository: **zheddhe/gitea-pull-request**

The repository and Marketplace publication are maintained independently from the maintainer's employer.

## Compatibility baseline for 0.7.0

The release baseline is intentionally conservative and matches the environments validated for the first Marketplace publication:

- **Visual Studio Code:** `1.133.0` or newer (`engines.vscode: ^1.133.0`);
- **Gitea:** `1.26.4` or newer; `1.26.4` is the server version used for the Phase 6 functional validation, and older Gitea versions are not claimed as supported for `0.7.0`;
- **Node.js:** `24.x` for dependency installation, CI, packaging and release publication.

`@types/vscode` may lag the VS Code product release cadence. For `0.7.0`, compilation uses the latest published typings available during the release preparation (`^1.125.0`) while extension-host tests run explicitly against VS Code `1.133.0`.

## Marketplace authentication

Automated Visual Studio Marketplace publication is **temporarily paused**.

The current Marketplace publisher portal does not expose a trusted-publishing policy configuration for the repository/workflow, so `.github/workflows/release.yml` does not currently request an OIDC token and does not attempt `vsce publish --oidc`.

Marketplace releases are published manually by uploading the exact VSIX produced and attached by the GitHub Release workflow.

The intended future trusted-publishing identity remains:

- GitHub owner: `zheddhe`
- Repository: `gitea-pull-request`
- Workflow: `.github/workflows/release.yml`
- Marketplace publisher: `zheddhe`

When the Marketplace publisher can be configured with that trusted-publishing policy, automated OIDC publication may be re-enabled. Do not add a long-lived Marketplace PAT to the repository merely to bypass the missing policy configuration.

## Release gate

A phase release is promoted only after implementation and documentation are ready.

For `0.7.0`, version metadata is already promoted. After any dependency-baseline change, regenerate the lockfile under Node.js 24 before running the final gate:

```bash
node --version
npm --version
npm install --package-lock-only
npm ci --include=dev
make verify
make reinstall-vsix
```

The expected Node major is `24`. Commit the regenerated `package-lock.json` together with the manifest dependency changes.

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
6. `make ci` performs the clean dependency install, compile, lint, tests and VSIX packaging under Xvfb on the Linux runner.
7. The generated versioned VSIX is uploaded to the GitHub Release.
8. While trusted publishing is paused, upload that exact GitHub Release VSIX manually to the Visual Studio Marketplace.

The workflow must fail rather than publish when the release identity is inconsistent.

## Workflow requirements

The release workflow intentionally uses:

- Node.js 24;
- VS Code 1.133.0 for extension-host tests;
- Gitea 1.26.4 as the minimum documented/tested server baseline for `0.7.0`;
- the project `Makefile` as the build/test/package source of truth;
- Xvfb for VS Code/Electron extension-host tests on the Linux GitHub runner;
- GitHub permission `contents: write` for attaching the VSIX to the GitHub Release;
- immutable SHA-pinned GitHub Actions with their semantic versions retained as comments;
- one release execution per tag through GitHub Actions concurrency;
- no stored Marketplace credential while automated publication is paused.

## First Marketplace publication

The first Marketplace publication (`0.7.0`) was bootstrapped manually from the VSIX produced by the GitHub Release workflow.

Before re-enabling automated Marketplace publication, confirm that the Marketplace publisher portal can define a trusted-publishing policy for the exact repository/workflow identity above. If that capability remains unavailable, keep Marketplace publication manual or contact Marketplace support rather than silently introducing a long-lived token.

## License and origin

The repository contains inherited MIT-licensed code from `dj0024javia/gitea-vscode-extension`. `LICENSE` preserves the inherited copyright notice and adds the copyright notice for the independently maintained product line. `NOTICE` documents the project origin.

Detaching the GitHub repository from its fork network, if done later, is independent from these license and attribution obligations.
