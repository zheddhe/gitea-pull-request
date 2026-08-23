SHELL := /bin/bash

NPM ?= npm
NPX ?= npx
CODE ?= code
VSCE_VERSION ?= 3.9.2
C8_VERSION ?= 10.1.3
VSCODE_TEST_VERSION ?= 1.133.0

PROJECT_NAME := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
RELEASE_VERSION ?=
ARTIFACT_ROOT ?= .artifacts
VSIX_DIR ?= $(ARTIFACT_ROOT)/vsix
VSIX_FILE := $(VSIX_DIR)/$(PROJECT_NAME)-$(VERSION).vsix
COVERAGE_DIR ?= $(ARTIFACT_ROOT)/coverage

.PHONY: help doctor lock bootstrap deps promote clean compile lint test coverage test-latest verify vsix rebuild-vsix install-vsix reinstall-vsix ci show-vsix

help: ## Show the available development targets
	@printf '%s\n' 'Gitea Pull Request development workflow'
	@printf '%s\n\n' 'Usage: make <target>'
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Check the local tools required to build/package/install the extension
	@command -v node >/dev/null || { echo 'ERROR: node is required.' >&2; exit 1; }
	@command -v $(NPM) >/dev/null || { echo 'ERROR: npm is required.' >&2; exit 1; }
	@command -v $(NPX) >/dev/null || { echo 'ERROR: npx is required.' >&2; exit 1; }
	@node_major=$$(node -p "Number(process.versions.node.split('.')[0])"); \
		if [ "$$node_major" -ne 24 ]; then \
			echo "ERROR: Node.js 24.x is the supported build/CI baseline for this release (found $$(node --version))." >&2; \
			exit 1; \
		fi
	@if command -v $(CODE) >/dev/null; then \
		echo "OK: VS Code CLI: $$($(CODE) --version | head -n 1)"; \
	else \
		echo "INFO: '$(CODE)' is not on PATH; build/package works, but make install-vsix will not."; \
	fi
	@echo "OK: Node $$(node --version), npm $$($(NPM) --version), VS Code test baseline $(VSCODE_TEST_VERSION), VSIX output: $(VSIX_FILE)"

lock: ## Create/update package-lock.json after any package.json dependency or metadata change
	$(NPM) install --package-lock-only --ignore-scripts
	@echo "package-lock.json synchronized with package.json. Review and commit it with package.json."

bootstrap: lock ## Synchronize the lock file, then install the exact dependency set (use after clone or package.json changes)
	$(NPM) ci --include=dev

deps: ## Install exactly the committed dependencies, including build/test tooling; fails if package.json and package-lock.json differ
	$(NPM) ci --include=dev

promote: ## Promote package.json + package-lock.json to RELEASE_VERSION without creating a git tag
	@test -n "$(RELEASE_VERSION)" || { echo "ERROR: RELEASE_VERSION is required, e.g. 'make promote RELEASE_VERSION=0.3.0'." >&2; exit 1; }
	@git diff --quiet && git diff --cached --quiet || { echo 'ERROR: working tree must be clean before version promotion.' >&2; exit 1; }
	@current=$$(node -p "require('./package.json').version"); \
		if [ "$$current" = "$(RELEASE_VERSION)" ]; then \
			echo "ERROR: package is already at version $(RELEASE_VERSION)." >&2; \
			exit 1; \
		fi
	$(NPM) version "$(RELEASE_VERSION)" --no-git-tag-version
	$(MAKE) deps
	@echo "Promoted $(PROJECT_NAME) to $(RELEASE_VERSION)."
	@echo "Review package.json and package-lock.json, then run 'make verify' and 'make reinstall-vsix' before committing the release promotion."

clean: ## Remove generated TypeScript output and local build artifacts (keeps cached VS Code test runtimes)
	rm -rf out "$(ARTIFACT_ROOT)"

compile: ## Compile the TypeScript extension
	$(NPM) run compile

lint: ## Run ESLint
	$(NPM) run lint

test: compile ## Run extension tests on the minimum supported VS Code version
	VSCODE_TEST_VERSION="$(VSCODE_TEST_VERSION)" $(NPM) test

coverage: compile ## Measure function/branch coverage for directly testable pure modules (informational, no threshold)
	rm -rf "$(COVERAGE_DIR)"
	$(NPX) --yes c8@$(C8_VERSION) \
		--all \
		--reports-dir "$(COVERAGE_DIR)" \
		--reporter text \
		--reporter json-summary \
		--include 'out/features/pullRequests/domain/createPullRequestModel.js' \
		--include 'out/features/pullRequests/domain/reviewPullRequestModel.js' \
		--include 'out/features/pullRequests/domain/visibilityRefreshPolicy.js' \
		./node_modules/.bin/mocha --ui tdd \
		out/test/suite/createPullRequestModel.test.js \
		out/test/suite/reviewPullRequestModel.test.js \
		out/test/suite/visibilityRefreshPolicy.test.js
	@echo "Coverage baseline written to $(COVERAGE_DIR)/coverage-summary.json (informational only; no release threshold)."

test-latest: compile ## Run extension tests against the latest stable VS Code as an additional compatibility check
	VSCODE_TEST_VERSION=stable $(NPM) test

verify: compile lint test ## Run the local quality gate used before packaging

$(VSIX_DIR):
	mkdir -p "$@"

vsix: doctor verify | $(VSIX_DIR) ## Build and validate a versioned VSIX under .artifacts/vsix
	$(NPX) --yes @vscode/vsce@$(VSCE_VERSION) package --out "$(VSIX_FILE)"
	@test -s "$(VSIX_FILE)" || { echo 'ERROR: VSIX package was not created.' >&2; exit 1; }
	@echo "VSIX ready: $(VSIX_FILE)"

rebuild-vsix: ## Clean, install committed dependencies, verify, and rebuild the local VSIX from scratch
	$(MAKE) clean
	$(MAKE) deps
	$(MAKE) vsix

install-vsix: ## Force-install the already-built local VSIX into VS Code
	@test -s "$(VSIX_FILE)" || { echo "ERROR: $(VSIX_FILE) does not exist. Run 'make vsix' first." >&2; exit 1; }
	@command -v $(CODE) >/dev/null || { echo "ERROR: VS Code CLI '$(CODE)' is not available on PATH." >&2; exit 1; }
	$(CODE) --install-extension "$(VSIX_FILE)" --force
	@echo "Installed: $(VSIX_FILE)"

reinstall-vsix: ## Full clean rebuild followed by forced local VSIX installation
	$(MAKE) rebuild-vsix
	$(MAKE) install-vsix

ci: ## Reproduce the CI build/package path from the committed lock file
	$(MAKE) clean
	$(MAKE) deps
	$(MAKE) vsix

show-vsix: ## Print the expected local VSIX path
	@echo "$(VSIX_FILE)"
