import * as vscode from "vscode";
import type { CIRunsProvider } from "../../../views/ciRunsProvider";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";
import type {
  PollingRegistrationHandle,
  PollingScheduler,
} from "./pollingScheduler";

const POST_ACTION_BURST_POLLS = 12;

export class CIRunsPollingService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private registration: PollingRegistrationHandle | undefined;
  private initialized = false;
  private burstPollsRemaining = 0;

  constructor(
    private readonly scheduler: PollingScheduler,
    private readonly signals: PollingLifecycleSignalService,
    private readonly provider: CIRunsProvider,
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
    // Gitea may acknowledge a rerun/cancel before the newly queued state is
    // visible through the runs endpoint. Keep a short live-polling window so
    // one early terminal response cannot send the resource back to the
    // five-minute terminal cadence.
    this.burstPollsRemaining = POST_ACTION_BURST_POLLS;
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
      this.burstPollsRemaining = 0;
      return;
    }

    if (this.registration) {
      this.registration.reconsider();
      return;
    }

    this.registration = this.scheduler.register({
      key: "ci-runs:loaded-repositories",
      context: () => ({
        ...this.signals.contextFor("ci-runs", "ci-runs"),
        lifecycle:
          this.provider.hasActiveRuns() || this.burstPollsRemaining > 0
            ? "pending"
            : "terminal",
      }),
      run: async () => {
        const result = await this.provider.pollLoadedRuns();
        if (!this.provider.hasActiveRuns() && this.burstPollsRemaining > 0) {
          this.burstPollsRemaining -= 1;
        } else if (this.provider.hasActiveRuns()) {
          this.burstPollsRemaining = 0;
        }
        return result;
      },
    });
  }
}
