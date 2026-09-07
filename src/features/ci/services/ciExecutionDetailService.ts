import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { GiteaWorkflowJob } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import {
  normalizeStepDetails,
  type CIStepDetailResult,
} from "../domain/ciExecutionDetail";

/**
 * Resolves structured job steps without multiplying requests for collapsed jobs.
 *
 * - If listWorkflowJobs already supplied `steps`, they are used immediately.
 * - If `steps` is absent, the individual job is fetched only on explicit detail
 *   resolution (normally when the job node is expanded).
 * - Results are cached until the owning run/repository is invalidated by the
 *   existing centralized CI refresh lifecycle.
 */
export class CIExecutionDetailService {
  private readonly stepCache = new Map<string, CIStepDetailResult>();

  constructor(private readonly api: Pick<GiteaApiClient, "getWorkflowJob">) {}

  async resolveJobSteps(
    repoInfo: RepoInfo,
    job: GiteaWorkflowJob,
  ): Promise<CIStepDetailResult> {
    const embedded = normalizeStepDetails(job.steps);
    if (embedded.availability === "available") return embedded;

    const key = stepCacheKey(repoInfo, job.run_id, job.id);
    const cached = this.stepCache.get(key);
    if (cached) return cached;

    const detail = await this.api.getWorkflowJob(repoInfo, job.id);
    const resolved = normalizeStepDetails(detail.steps);
    this.stepCache.set(key, resolved);
    return resolved;
  }

  invalidateRun(repoInfo: RepoInfo, runId: number): void {
    const prefix = `${repoInfo.key}:${runId}:`;
    for (const key of this.stepCache.keys()) {
      if (key.startsWith(prefix)) this.stepCache.delete(key);
    }
  }

  invalidateRepo(repoInfo: RepoInfo): void {
    const prefix = `${repoInfo.key}:`;
    for (const key of this.stepCache.keys()) {
      if (key.startsWith(prefix)) this.stepCache.delete(key);
    }
  }

  clear(): void {
    this.stepCache.clear();
  }
}

export function stepCacheKey(
  repoInfo: Pick<RepoInfo, "key">,
  runId: number,
  jobId: number,
): string {
  return `${repoInfo.key}:${runId}:${jobId}`;
}
