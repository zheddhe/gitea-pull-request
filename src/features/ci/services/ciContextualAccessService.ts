import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { GiteaWorkflowJob } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import {
  CIJobItem,
  CIRunItem,
  CIRunsProvider,
  RepoGroupItem,
} from "../../../views/ciRunsProvider";

/**
 * Contextual access to the existing CI projection.
 *
 * This deliberately routes through CIRunsProvider instead of issuing a second
 * listWorkflowJobs request or maintaining another cache. The provider remains
 * the normalized source used by CI / Actions and its adaptive polling service.
 */
export class CIContextualAccessService {
  constructor(
    private readonly api: GiteaApiClient,
    private readonly provider: CIRunsProvider,
  ) {}

  async loadJobsForRun(
    repoInfo: RepoInfo,
    runId: number,
  ): Promise<readonly GiteaWorkflowJob[]> {
    if (!Number.isSafeInteger(runId) || runId <= 0) return [];

    // Ensure the repository is part of CIRunsProvider state so the existing
    // CIRunsPollingService owns subsequent run-state refreshes. This does not
    // create a contextual polling registration.
    await this.provider.getChildren(new RepoGroupItem(repoInfo, true));

    const run = await this.api.getWorkflowRun(repoInfo, runId);
    const children = await this.provider.getChildren(new CIRunItem(run, repoInfo));
    return children
      .filter((child): child is CIJobItem => child instanceof CIJobItem)
      .map((child) => child.job);
  }
}
