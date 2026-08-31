import * as vscode from "vscode";
import { debug, info } from "../../../debug/outputChannel";

export interface IssueCreationRepositoryRef {
  key: string;
  owner: string;
  name: string;
  fullName: string;
}

export type IssueCreationState =
  | { kind: "idle" }
  | { kind: "creating"; repository: IssueCreationRepositoryRef };

export type IssueContextKeySetter = (
  key: string,
  value: unknown,
) => Thenable<unknown>;

const idleIssueCreationState: IssueCreationState = { kind: "idle" };

const defaultContextKeySetter: IssueContextKeySetter = (key, value) =>
  vscode.commands.executeCommand("setContext", key, value);

export class IssueCreationSessionService implements vscode.Disposable {
  private state: IssueCreationState = idleIssueCreationState;
  private readonly stateEmitter = new vscode.EventEmitter<IssueCreationState>();

  readonly onDidChangeState = this.stateEmitter.event;

  constructor(
    private readonly setContextKey: IssueContextKeySetter = defaultContextKeySetter,
  ) {}

  get current(): IssueCreationState {
    return this.state;
  }

  async initialize(): Promise<void> {
    await this.syncContextKeys();
    debug(`[issue-creation] initialized state=${this.describe(this.state)}`);
  }

  async start(repository: IssueCreationRepositoryRef): Promise<void> {
    await this.transition({ kind: "creating", repository });
  }

  async clear(): Promise<void> {
    await this.transition(idleIssueCreationState);
  }

  async invalidateIfRepositoryUnavailable(
    availableRepositoryKeys: Iterable<string>,
  ): Promise<boolean> {
    if (this.state.kind === "idle") return false;

    const available = new Set(availableRepositoryKeys);
    if (available.has(this.state.repository.key)) return false;

    await this.clear();
    return true;
  }

  dispose(): void {
    this.stateEmitter.dispose();
  }

  private async transition(nextState: IssueCreationState): Promise<void> {
    const previous = this.describe(this.state);
    const next = this.describe(nextState);
    this.state = nextState;
    await this.syncContextKeys();
    info(`[issue-creation] ${previous} -> ${next}`);
    this.stateEmitter.fire(this.state);
  }

  private describe(state: IssueCreationState): string {
    return state.kind === "idle"
      ? "idle"
      : `creating repo=${state.repository.fullName}`;
  }

  private async syncContextKeys(): Promise<void> {
    const creating = this.state.kind === "creating";
    await Promise.all([
      this.setContextKey("gitea.issueCreation.active", creating),
      this.setContextKey(
        "gitea.issueCreation.repositoryKey",
        creating ? this.state.repository.key : undefined,
      ),
    ]);
  }
}
