import * as vscode from "vscode";
import type { IssuesProvider } from "../../../views/issuesProvider";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";
import type {
  PollingRegistrationHandle,
  PollingScheduler,
} from "./pollingScheduler";

export class IssuesPollingService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private registration: PollingRegistrationHandle | undefined;
  private initialized = false;

  constructor(
    private readonly scheduler: PollingScheduler,
    private readonly signals: PollingLifecycleSignalService,
    private readonly provider: IssuesProvider,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.syncRegistration();
    this.disposables.push(
      this.provider.onDidChangePollingState(() => this.syncRegistration()),
      this.signals.onDidChange(() => this.registration?.reconsider()),
    );
  }

  accelerate(): void {
    this.registration?.accelerate();
  }

  dispose(): void {
    this.registration?.dispose();
    this.registration = undefined;
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private syncRegistration(): void {
    if (!this.provider.hasLoadedRepos()) {
      this.registration?.dispose();
      this.registration = undefined;
      return;
    }

    if (this.registration) {
      this.registration.reconsider();
      return;
    }

    this.registration = this.scheduler.register({
      key: "issues:loaded-repositories",
      context: () => ({
        ...this.signals.contextFor("issues", "issues"),
        lifecycle: "active",
      }),
      run: async () => this.provider.pollLoadedIssues(),
    });
  }
}
