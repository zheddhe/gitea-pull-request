import * as vscode from "vscode";
import type { GiteaCombinedStatus, GiteaReview } from "../../../api/types";
import type { RepoManager } from "../../../context/repoManager";
import type { PullRequestProvider } from "../../../views/pullRequestProvider";
import type { PullRequestReviewApi } from "../../pullRequests/services/pullRequestReviewApi";
import type { PullRequestSessionService } from "../../pullRequests/services/pullRequestSessionService";
import { warn } from "../../../debug/outputChannel";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";
import type {
  PollingRegistrationHandle,
  PollingScheduler,
} from "./pollingScheduler";

const PENDING_STATUS_NAMES = new Set([
  "pending",
  "running",
  "waiting",
  "queued",
  "in_progress",
]);
const POST_ACTION_BURST_POLLS = 12;

export class PullRequestReadinessPollingService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private registration: PollingRegistrationHandle | undefined;
  private identity: string | undefined;
  private fingerprint: string | undefined;
  private checksPending = true;
  private burstPollsRemaining = 0;
  private initialized = false;

  constructor(
    private readonly scheduler: PollingScheduler,
    private readonly signals: PollingLifecycleSignalService,
    private readonly reviewApi: PullRequestReviewApi,
    private readonly repoManager: RepoManager,
    private readonly session: PullRequestSessionService,
    private readonly prProvider: PullRequestProvider,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.syncRegistration();
    this.disposables.push(
      this.session.onDidChangeState(() => this.syncRegistration()),
      this.repoManager.onDidChange(() => this.syncRegistration()),
      this.signals.onDidChange(() => this.registration?.reconsider()),
    );
  }

  accelerate(): void {
    this.burstPollsRemaining = POST_ACTION_BURST_POLLS;
    this.registration?.accelerate();
  }

  dispose(): void {
    this.clearRegistration();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private syncRegistration(): void {
    const state = this.session.current;
    if (state.kind !== "active") {
      this.clearRegistration();
      return;
    }
    const repoInfo = this.repoManager
      .getRepos()
      .find((repo) => repo.key === state.repository.key);
    if (!repoInfo) {
      this.clearRegistration();
      return;
    }

    const identity = `${state.repository.key}::pr:${state.pullRequest.number}::readiness:${state.pullRequest.head.sha}`;
    if (identity === this.identity) {
      this.registration?.reconsider();
      return;
    }

    this.clearRegistration();
    this.identity = identity;
    this.checksPending = true;
    this.registration = this.scheduler.register({
      key: identity,
      context: () => ({
        ...this.signals.contextFor(
          "pull-request-readiness",
          "pull-request-review",
        ),
        lifecycle:
          this.checksPending || this.burstPollsRemaining > 0 ? "pending" : "active",
      }),
      run: async () => {
        const current = this.session.current;
        if (
          current.kind !== "active" ||
          `${current.repository.key}::pr:${current.pullRequest.number}::readiness:${current.pullRequest.head.sha}` !== identity
        ) {
          return { changed: false };
        }
        try {
          const [status, reviews] = await Promise.all([
            this.reviewApi.getCombinedStatus(repoInfo, current.pullRequest.head.sha),
            this.reviewApi.listReviews(repoInfo, current.pullRequest.number),
          ]);
          this.checksPending = hasPendingChecks(status);
          if (this.checksPending) {
            this.burstPollsRemaining = 0;
          } else if (this.burstPollsRemaining > 0) {
            this.burstPollsRemaining -= 1;
          }
          const nextFingerprint = readinessFingerprint(status, reviews);
          if (this.fingerprint === undefined) {
            this.fingerprint = nextFingerprint;
            return { changed: false };
          }
          if (nextFingerprint === this.fingerprint) return { changed: false };

          this.fingerprint = nextFingerprint;
          await this.session.activate(
            current.repository,
            current.pullRequest,
            current.checkoutState,
          );
          this.prProvider.refresh();
          return { changed: true };
        } catch (error) {
          warn(
            `[polling] pr-readiness failed repo=${repoInfo.label} pr=#${current.pullRequest.number}: ${(error as Error).message}`,
          );
          return { changed: false };
        }
      },
    });
  }

  private clearRegistration(): void {
    this.registration?.dispose();
    this.registration = undefined;
    this.identity = undefined;
    this.fingerprint = undefined;
    this.checksPending = true;
    this.burstPollsRemaining = 0;
  }
}

export function hasPendingChecks(status: GiteaCombinedStatus): boolean {
  const aggregate = String(status.state ?? "").toLowerCase();
  if (PENDING_STATUS_NAMES.has(aggregate)) return true;
  return status.statuses.some((item) =>
    PENDING_STATUS_NAMES.has(String(item.state ?? "").toLowerCase()),
  );
}

export function readinessFingerprint(
  status: GiteaCombinedStatus,
  reviews: readonly GiteaReview[],
): string {
  const statusFingerprint = [
    status.state,
    status.total_count,
    ...status.statuses
      .map((item) =>
        [item.id, item.context, item.state, item.description, item.target_url].join(":"),
      )
      .sort(),
  ].join("|");
  const reviewFingerprint = reviews
    .map((review) =>
      [review.id, review.user.login, review.state, review.submitted_at, review.stale].join(":"),
    )
    .sort()
    .join("|");
  return `${statusFingerprint}::${reviewFingerprint}`;
}
