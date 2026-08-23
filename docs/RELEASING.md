# Releasing Gitea Pull Request

This document describes the release path for **Gitea Pull Request** on GitHub and the Visual Studio Marketplace.

## Release identity

- Marketplace publisher display name: **Rémy Canal**
- Marketplace publisher ID: **zheddhe**
- Extension package name: **gitea-pull-request**
- Marketplace extension identity: **zheddhe.gitea-pull-request**
- GitHub repository: **zheddhe/gitea-pull-request**

The repository and Marketplace publication are maintained independently from the maintainer's employer.

## Compatibility baseline for 0.8.0

The `0.8.0` release keeps the validated compatibility baseline established in the previous release:

- **Visual Studio Code:** `1.133.0` or newer (`engines.vscode: ^1.133.0`);
- **Gitea:** `1.26.4` or newer; older Gitea versions are not claimed as supported;
- **Node.js:** `24.x` for dependency installation, CI, packaging and release tooling.

`@types/vscode` may lag the VS Code product release cadence. Compilation currently uses the published typings declared in `package.json`, while extension-host tests run explicitly against VS Code `1.133.0` by default.

## Publication model

GitHub is the automated release source of truth. Marketplace publication is intentionally manual.

The repository release workflow:

1. validates the release tag against the package version and extension identity;
2. performs a clean build, lint, Extension Host test and package pass;
3. creates the versioned VSIX;
4. attaches that exact VSIX to the GitHub Release.

The workflow does **not** publish directly to the Visual Studio Marketplace and does not require a Marketplace PAT or GitHub OIDC publishing credential.

After the GitHub Release workflow succeeds, upload the exact VSIX attached to that release through the Visual Studio Marketplace publisher management page. Do not rebuild a separate Marketplace artifact.

## Release gate

A release is promoted only after implementation and documentation are ready.

Promote the package and lock metadata together before merge:

```bash
make promote RELEASE_VERSION=<target-version>
```

For `0.8.0`, both `package.json` and `package-lock.json` must contain `0.8.0` on the release PR branch before merge.

Run the final local gate under Node.js 24:

```bash
node --version
npm --version
make verify
make reinstall-vsix
```

Confirm the expected local artifact exists:

```text
.artifacts/vsix/gitea-pull-request-0.8.0.vsix
```

Perform the final smoke pass before merging the release PR.

## GitHub release sequence

1. Merge the validated release PR into `main`.
2. Create tag `v<package-version>` on the merged release commit.
3. Create and publish the corresponding GitHub Release.
4. Publishing the GitHub Release triggers `.github/workflows/release.yml`.
5. The workflow checks out the release tag and validates tag version, package version, publisher ID and package name.
6. `make ci` performs the clean dependency install, compile, lint, tests and VSIX packaging.
7. The generated versioned VSIX is attached to the GitHub Release.
8. Upload that exact GitHub Release VSIX manually to the Visual Studio Marketplace publisher management page.

The workflow must fail rather than publish an artifact when the release identity is inconsistent.

## Workflow requirements

The release workflow intentionally uses:

- Node.js 24;
- VS Code 1.133.0 for extension-host tests;
- Gitea 1.26.4 as the minimum documented/tested server baseline;
- the project `Makefile` as the build/test/package source of truth;
- pinned `@vscode/vsce` version `3.9.2` for packaging;
- GitHub `contents: write` permission only;
- one release execution per tag through GitHub Actions concurrency;
- no stored Marketplace publication credential.

## Marketplace publication

Before uploading a release VSIX, confirm in the Marketplace publisher portal that:

- publisher display name is **Rémy Canal** and publisher ID is `zheddhe`;
- the extension identity is `zheddhe.gitea-pull-request`;
- Marketplace-facing README, icon, repository, support and license information are correct;
- the VSIX being uploaded is exactly the artifact produced and attached by the corresponding GitHub Release workflow.

Marketplace automation can be reconsidered later if a stable trusted-publishing path becomes available and is deliberately re-enabled. Until then, manual upload is the documented release path.

## License and origin

The repository contains inherited MIT-licensed code from `dj0024javia/gitea-vscode-extension`. `LICENSE` preserves the inherited copyright notice and adds the copyright notice for the independently maintained product line. `NOTICE` documents the project origin.

Detaching the GitHub repository from its fork network, if done later, is independent from these license and attribution obligations.
