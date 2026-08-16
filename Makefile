SHELL := /bin/bash

NPM ?= npm
NPX ?= npx
CODE ?= code
VSCE_VERSION ?= 3.9.2
VSCODE_TEST_VERSION ?= 1.85.0

PROJECT_NAME := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
ARTIFACT_ROOT ?= .artifacts
VSIX_DIR ?= $(ARTIFACT_ROOT)/vsix
VSIX_FILE := $(VSIX_DIR)/$(PROJECT_NAME)-$(VERSION).vsix

.PHONY: help doctor deps clean compile lint test test-latest verify vsix rebuild-vsix install-vsix reinstall-vsix ci show-vsix

help: ## Show the available development targets
	@printf '%s\n' 'Gitea Pull Request development workflow'
	@printf '%s\n\n' 'Usage: make <target>'
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Check the local tools required to build/package/install the extension
	@command -v node >/dev/null || { echo 'ERROR: node is required.' >&2; exit 1; }
	@command -v $(NPM) >/dev/null || { echo 'ERROR: npm is required.' >&2; exit 1; }
	@command -v $(NPX) >/dev/null || { echo 'ERROR: npx is required.' >&2; exit 1; }
	@node_major=$$(node -p "Number(process.versions.node.split('.')[0])"); \
		if [ "$$node_major" -lt 22 ]; then \
			echo "ERROR: Node.js 22+ is required for the pinned @vscode/vsce $(VSCE_VERSION) packaging tool (found $$(node --version))." >&2; \
			exit 1; \
		fi
	@if command -v $(CODE) >/dev/null; then \
		echo "OK: VS Code CLI: $$($(CODE) --version | head -n 1)"; \
	else \
		echo "INFO: '$(CODE)' is not on PATH; build/package works, but make install-vsix will not."; \
	fi
	@echo "OK: Node $$(node --version), npm $$($(NPM) --version), VSIX output: $(VSIX_FILE)"

deps: ## Install exactly the dependencies from package-lock.json
	$(NPM) ci

clean: ## Remove generated TypeScript output and local build artifacts (keeps cached VS Code test runtimes)
	rm -rf out "$(ARTIFACT_ROOT)"

compile: ## Compile the TypeScript extension
	$(NPM) run compile

lint: ## Run ESLint
	$(NPM) run lint

test: compile ## Run extension tests on the minimum supported VS Code version
	VSCODE_TEST_VERSION="$(VSCODE_TEST_VERSION)" $(NPM) test

test-latest: compile ## Run extension tests against the latest stable VS Code as an additional compatibility check
	VSCODE_TEST_VERSION=stable $(NPM) test

verify: compile lint test ## Run the local quality gate used before packaging

$(VSIX_DIR):
	mkdir -p "$@"

vsix: doctor verify | $(VSIX_DIR) ## Build and validate a versioned VSIX under .artifacts/vsix
	$(NPX) --yes @vscode/vsce@$(VSCE_VERSION) package --out "$(VSIX_FILE)"
	@test -s "$(VSIX_FILE)" || { echo 'ERROR: VSIX package was not created.' >&2; exit 1; }
	@echo "VSIX ready: $(VSIX_FILE)"

rebuild-vsix: ## Clean, reinstall dependencies, verify, and rebuild the local VSIX from scratch
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

ci: ## Reproduce the CI build/package path from a clean dependency install
	$(MAKE) clean
	$(MAKE) deps
	$(MAKE) vsix

show-vsix: ## Print the expected local VSIX path
	@echo "$(VSIX_FILE)"
