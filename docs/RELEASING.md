# Releasing Gitea Pull Request

This document describes the release path for **Gitea Pull Request** on GitHub and the Visual Studio Marketplace.

## Release identity

- Marketplace publisher display name: **Rémy Canal**
- Marketplace publisher ID: **zheddhe**
- Extension package name: **gitea-pull-request**
- Marketplace extension identity: **zheddhe.gitea-pull-request**
- GitHub repository: **zheddhe/gitea-pull-request**

The repository and Marketplace publication are maintained independently from the maintainer's employer.

## Compatibility baseline for 0.9.0

The `0.9.0` release keeps the established compatibility baseline while capability-gating newer inline-review operations:

- **Visual Studio Code:** `1.133.0` or newer (`engines.vscode: ^1.133.0`);
- **Gitea:** `1.26.4` or newer for the established extension baseline; older Gitea versions are not claimed as supported;
- **Gitea 1.27+** for inline-review Reply support, with unsupported actions hidden on older compatible servers;
- **Node.js:** `24.x` for dependency installation, CI, packaging and release tooling.

`@types/vscode` may lag the VS Code product release cadence. Compilation currently uses the published typings declared in `package.json`, while extension-host tests run explicitly against VS Code `1.133.0` by default.

## Publication model

GitHub is the automated release-artifact source of truth. Marketplace publication is intentionally manual.

GitHub immutable releases require assets to be attached **before** publication. The repository therefore uses a draft-first release workflow:

1. pushing a version tag (`v*`) triggers `.github/workflows/release.yml`;
2. the workflow validates the tag against package identity/version;
3. it performs a clean build, lint, Extension Host test and package pass;
4. it creates the versioned VSIX;
5. it uploads the VSIX as a recoverable GitHub Actions artifact;
6. it creates a **draft GitHub Release** for the tag and attaches that exact VSIX;
7. the maintainer reviews/edits release notes and publishes the draft manually;
8. publication makes the release and its assets immutable;
9. the exact same verified VSIX is uploaded manually to the Visual Studio Marketplace.

The workflow does **not** publish directly to the Visual Studio Marketplace and does not require a Marketplace PAT or GitHub OIDC publishing credential.

Do not publish a GitHub Release before the VSIX is attached. A published immutable release cannot accept additional assets.

## Release gate

A release is promoted only after implementation and documentation are ready.

Promote the package and lock metadata together before merge:

```bash
make promote RELEASE_VERSION=<target-version>
```

For `0.9.0`, both `package.json` and `package-lock.json` must contain `0.9.0` on the release PR branch before merge.

Run the final local gate under Node.js 24:

```bash
node --version
npm --version
make verify
make reinstall-vsix
```

Confirm the expected local artifact exists:

```text
.artifacts/vsix/gitea-pull-request-0.9.0.vsix
```

Perform the final smoke pass before merging the release PR. For `0.9.0`, that smoke pass should cover the interactive PR review workflow and Issue creation both with and without `.gitea/ISSUE_TEMPLATE/` templates.

## GitHub release sequence

1. Merge the validated release PR into `main`.
2. Create and push tag `v<package-version>` on the merged release commit.
3. The tag push triggers `.github/workflows/release.yml`.
4. The workflow checks out the release tag and validates tag version, package version, publisher ID and package name.
5. `make ci` performs the clean dependency install, compile, lint, tests and VSIX packaging.
6. The generated VSIX is uploaded as a GitHub Actions artifact for recovery/debugging purposes.
7. The workflow creates a **draft GitHub Release** and attaches the verified VSIX.
8. Review/edit the release title and notes while it is still a draft.
9. Publish the draft only after confirming the VSIX is present. The release then becomes immutable.
10. Upload that exact verified VSIX manually to the Visual Studio Marketplace publisher management page.

The workflow must fail rather than prepare a release when the release identity is inconsistent.

## Rebuilding an existing tag

`release.yml` also supports a manual `workflow_dispatch` input named `release_tag`.

Use this only to rebuild/verify a tag that already exists, for example when recovering an artifact after a failed release workflow:

```text
release_tag = v0.9.0
```

Manual rebuild mode:

- checks out and validates the requested tag;
- runs the same clean CI/package path;
- uploads the resulting VSIX as a GitHub Actions artifact;
- **does not create, edit, delete or attach assets to an existing GitHub Release**.

This is intentional: an already published immutable release cannot be modified safely. Never delete an immutable release merely to retry asset upload; GitHub prevents reuse of the same release tag name after that lifecycle.

## Workflow requirements

The release workflow intentionally uses:

- Node.js 24;
- VS Code 1.133.0 for extension-host tests;
- Gitea 1.26.4 as the minimum documented/tested server baseline;
- capability gating for newer Gitea inline-review operations;
- the project `Makefile` as the build/test/package source of truth;
- pinned `@vscode/vsce` version `3.9.2` for packaging;
- GitHub `contents: write` permission only;
- one release execution per tag through GitHub Actions concurrency;
- a 30-day recoverable workflow artifact for each verified VSIX;
- no stored Marketplace publication credential.

## Marketplace publication

Before uploading a release VSIX, confirm in the Marketplace publisher portal that:

- publisher display name is **Rémy Canal** and publisher ID is `zheddhe`;
- the extension identity is `zheddhe.gitea-pull-request`;
- Marketplace-facing README, icon, repository, support and license information are correct;
- the VSIX being uploaded is exactly the artifact verified by the corresponding release workflow.

For normal releases, prefer the VSIX attached to the draft/published GitHub Release. For recovery of an already immutable release, use the exact VSIX produced by manual rebuild mode.

Marketplace automation can be reconsidered later if a stable trusted-publishing path becomes available and is deliberately re-enabled. Until then, manual upload is the documented release path.

## License and origin

The repository contains inherited MIT-licensed code from `dj0024javia/gitea-vscode-extension`. `LICENSE` preserves the inherited copyright notice and adds the copyright notice for the independently maintained product line. `NOTICE` documents the project origin.

Detaching the GitHub repository from its fork network, if done later, is independent from these license and attribution obligations.
