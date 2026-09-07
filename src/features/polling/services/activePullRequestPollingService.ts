import * as vscode from "vscode";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { GiteaPullRequest } from "../../../api/types";
import type { RepoManager } from "../../../context/repoManager";
import { debug, warn } from "../../../debug/outputChannel";
import type { PullRequestProvider } from "../../../views/pullRequestProvider";
import type { PullRequestSessionService } from "../../pullRequests/services/pullRequestSessionService";
import type { PollingLifecycle } from "../domain/adaptivePollingPolicy";
import type { PollingLifecycleSignalService } from "./pollingLifecycleSignalService";
import type {
  PollingRegistrationHandle,
  PollingScheduler,
} from "./pollingScheduler";

export class ActivePullRequestPollingService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private registration: PollingRegistrationHandle | undefined;
  private registeredIdentity: string | undefined;
  private resourceLifecycle: PollingLifecycle = "active";
  private initialized = false;

  constructor(
    private readonly scheduler: PollingScheduler,
    private readonly signals: PollingLifecycleSignalService,
    private readonly api: GiteaApiClient,
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
      this.signals.onDidChange(() => this.registration?.reconsider()),
      this.repoManager.onDidChange(() => this.syncRegistration()),
    );
  }

  accelerate(): void {
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

    const identity = `${state.repository.key}::pr:${state.pullRequest.number}`;
    this.resourceLifecycle = lifecycleForPullRequest(state.pullRequest);
    if (identity === this.registeredIdentity) {
      this.registration?.reconsider();
      return;
    }

    this.clearRegistration();
    this.registeredIdentity = identity;
    this.registration = this.scheduler.register({
      key: identity,
      context: () => ({
        ...this.signals.contextFor("pull-request", "pull-request-review"),
        lifecycle: this.resourceLifecycle,
      }),
      run: async () => {
        const before = this.session.current;
        if (
          before.kind !== "active" ||
          `${before.repository.key}::pr:${before.pullRequest.number}` !== identity
        ) {
          return { changed: false };
        }

        try {
          const pullRequest = await this.api.getPullRequest(
            repoInfo,
            before.pullRequest.number,
          );
          const current = this.session.current;
          if (
            current.kind !== "active" ||
            `${current.repository.key}::pr:${current.pullRequest.number}` !== identity
          ) {
            return { changed: false };
          }

          this.resourceLifecycle = lifecycleForPullRequest(pullRequest);
          const changed =
            pullRequestFingerprint(current.pullRequest) !==
            pullRequestFingerprint(pullRequest);
          if (!changed) return { changed: false };

          debug(
            `[polling] active-pr changed repo=${repoInfo.label} pr=#${pullRequest.number} head=${pullRequest.head.sha.slice(0, 8)} state=${pullRequest.state} merged=${pullRequest.merged}`,
          );
          await this.session.activate(
            current.repository,
            pullRequest,
            current.checkoutState,
          );
          this.prProvider.refresh();
          return { changed: true };
        } catch (error) {
          warn(
            `[polling] active-pr failed repo=${repoInfo.label} pr=#${before.pullRequest.number}: ${(error as Error).message}`,
          );
          return { changed: false };
        }
      },
    });
  }

  private clearRegistration(): void {
    this.registration?.dispose();
    this.registration = undefined;
    this.registeredIdentity = undefined;
  }
}

export function lifecycleForPullRequest(
  pullRequest: Pick<GiteaPullRequest, "state" | "merged">,
): PollingLifecycle {
  return pullRequest.state === "open" && !pullRequest.merged
    ? "active"
    : "terminal";
}

export function pullRequestFingerprint(
  pullRequest: Pick<
    GiteaPullRequest,
    | "title"
    | "body"
    | "state"
    | "merged"
    | "updated_at"
    | "comments"
    | "review_comments"
    | "labels"
    | "head"
    | "base"
  >,
): string {
  const labels = (pullRequest.labels ?? [])
    .map((label) => `${label.id}:${label.name}:${label.color}`)
    .sort()
    .join(",");
  return [
    pullRequest.title,
    pullRequest.body,
    pullRequest.state,
    pullRequest.merged ? "merged" : "open",
    pullRequest.updated_at,
    pullRequest.comments,
    pullRequest.review_comments,
    labels,
    pullRequest.head.sha,
    pullRequest.base.sha,
  ].join("|");
}
