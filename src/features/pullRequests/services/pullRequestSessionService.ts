import * as vscode from "vscode";
import { GiteaPullRequest } from "../../../api/types";
import {
  CheckoutState,
  idlePullRequestState,
  PullRequestWorkspaceState,
  RepositoryRef,
} from "../domain/pullRequestState";

export type ContextKeySetter = (key: string, value: unknown) => Thenable<unknown>;

const defaultContextKeySetter: ContextKeySetter = (key, value) =>
  vscode.commands.executeCommand("setContext", key, value);

export class PullRequestSessionService implements vscode.Disposable {
  private state: PullRequestWorkspaceState = idlePullRequestState;
  private readonly stateEmitter = new vscode.EventEmitter<PullRequestWorkspaceState>();

  readonly onDidChangeState = this.stateEmitter.event;

  constructor(private readonly setContextKey: ContextKeySetter = defaultContextKeySetter) {}

  get current(): PullRequestWorkspaceState {
    return this.state;
  }

  async initialize(): Promise<void> {
    await this.syncContextKeys();
  }

  async startCreating(
    repository: RepositoryRef,
    baseBranch: string,
    headBranch: string,
  ): Promise<void> {
    await this.transition({
      kind: "creating",
      repository,
      baseBranch,
      headBranch,
    });
  }

  async activate(
    repository: RepositoryRef,
    pullRequest: GiteaPullRequest,
    checkoutState: CheckoutState = { kind: "notCheckedOut" },
  ): Promise<void> {
    await this.transition({
      kind: "active",
      repository,
      pullRequest,
      checkoutState,
    });
  }

  async setCheckoutState(checkoutState: CheckoutState): Promise<void> {
    if (this.state.kind !== "active") {
      return;
    }

    await this.transition({
      ...this.state,
      checkoutState,
    });
  }

  async markMerged(
    repository: RepositoryRef,
    pullRequest: GiteaPullRequest,
    options: {
      localBranchExists: boolean;
      remoteBranchExists: boolean;
    },
  ): Promise<void> {
    await this.transition({
      kind: "merged",
      repository,
      pullRequest,
      ...options,
    });
  }

  async invalidateIfRepositoryUnavailable(
    availableRepositoryKeys: Iterable<string>,
  ): Promise<boolean> {
    if (this.state.kind === "idle") {
      return false;
    }

    const available = new Set(availableRepositoryKeys);
    if (available.has(this.state.repository.key)) {
      return false;
    }

    await this.clear();
    return true;
  }

  async clear(): Promise<void> {
    await this.transition(idlePullRequestState);
  }

  dispose(): void {
    this.stateEmitter.dispose();
  }

  private async transition(nextState: PullRequestWorkspaceState): Promise<void> {
    this.state = nextState;
    await this.syncContextKeys();
    this.stateEmitter.fire(this.state);
  }

  private async syncContextKeys(): Promise<void> {
    const active = this.state.kind === "active";
    const creating = this.state.kind === "creating";
    const merged = this.state.kind === "merged";
    const checkedOut =
      this.state.kind === "active" &&
      this.state.checkoutState.kind === "checkedOut";

    await Promise.all([
      this.setContextKey("gitea.prSession.active", active),
      this.setContextKey("gitea.prSession.creating", creating),
      this.setContextKey("gitea.prSession.merged", merged),
      this.setContextKey("gitea.prSession.checkedOut", checkedOut),
      this.setContextKey(
        "gitea.prSession.repositoryKey",
        this.state.kind === "idle" ? undefined : this.state.repository.key,
      ),
      this.setContextKey(
        "gitea.prSession.pullRequestNumber",
        this.state.kind === "active" || this.state.kind === "merged"
          ? this.state.pullRequest.number
          : undefined,
      ),
    ]);
  }
}
