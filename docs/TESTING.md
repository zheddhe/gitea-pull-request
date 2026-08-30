# Testing strategy

The test suite intentionally uses two complementary execution paths.

## Extension Host suite

`make test` compiles the extension and runs every `*.test.js` suite inside the VS Code Extension Development Host through `@vscode/test-electron`.

This remains the functional compatibility gate because production modules may import the `vscode` API even when their core behavior is otherwise deterministic.

The current suites fall into four practical layers:

### Domain and pure behavior

- `createPullRequestModel.test.ts`
- `reviewPullRequestModel.test.ts`
- `visibilityRefreshPolicy.test.ts`
- `branchCleanupService.test.ts` for its exported planning/execution helpers
- `repoContext.test.ts`
- pure helper scenarios in `repoManager.test.ts`

Prefer direct behavioral assertions in this layer. These tests are the best candidates for direct coverage when the production module can load without VS Code.

### Service and orchestration behavior

- `pullRequestSessionService.test.ts`
- `conflictResolutionService.test.ts`
- `conflictResolutionCoordinator.test.ts`

These characterize state transitions and workflow decisions. Keep orchestration tests focused on externally meaningful decisions rather than implementation call order unless ordering is itself part of the workflow contract.

### Presentation and contribution contracts

- `activityBarIconSemantics.test.ts`
- `activityBarRowActions.test.ts`
- `activityBarTopology.test.ts`
- `ciRunPresentation.test.ts`
- `editableWebviewRetention.test.ts`
- `issueAssignment.test.ts`
- `issueDetailMarkdown.test.ts`
- `issueTreePresentation.test.ts`
- `postMergePresentation.test.ts`
- `prDetailPresentation.test.ts`
- `reviewVisibilityRefresh.test.ts`

`package.json` contribution assertions are retained because command/view/menu topology is declarative and is difficult to exercise meaningfully through a unit API. Source-contract assertions are acceptable when they protect VS Code contribution or Webview topology that would otherwise require brittle full UI automation; avoid adding source-text checks when an exported behavioral function can be tested instead.

### Extension Host runner

- `src/test/runTest.ts`
- `src/test/suite/index.ts`

These launch and discover the full compiled suite. They are infrastructure, not coverage targets.

## Direct coverage baseline

Run:

```bash
make coverage
```

The coverage path uses pinned `c8` against modules that can execute under plain Node without importing `vscode`:

- `createPullRequestModel`
- `reviewPullRequestModel`
- `visibilityRefreshPolicy`

The command reports statement, branch, function and line coverage and writes `.artifacts/coverage/coverage-summary.json`.

Coverage is observational. There is deliberately no percentage threshold. Compare reports over time to identify newly uncovered functions or decision paths, then decide whether the missing path is behavior worth characterizing. Do not refactor VS Code glue merely to increase a global percentage.

The first measured baseline for this scope established a useful reference and immediately highlighted under-characterized merge-readiness branches. Adding targeted tests for mergeability uncertainty, permissions, pending/warning checks, unavailable required checks and latest-review semantics improved the signal without changing production code. That workflow—measure, inspect, characterize—is the intended use of coverage.

## Maintenance rules

- Prefer behavior/domain tests over source-text assertions.
- Keep source-contract tests only where they protect declarative VS Code/Webview topology that is impractical to execute directly.
- Do not duplicate an assertion across suites unless the two assertions protect different contracts (for example, a manifest contribution versus runtime presentation semantics).
- Use branch/function coverage as a regression and discovery signal, not as a release threshold.
- `make test` remains the functional Extension Host gate; `make coverage` remains an informational development measurement.
