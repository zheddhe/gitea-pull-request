import type { RepoInfo } from "../../../context/repoManager";
import {
  normalizeArtifactDetails,
  type CIArtifactDetailResult,
} from "../domain/ciExecutionDetail";
import type { GiteaActionsDetailApi } from "./giteaActionsDetailApi";

/** Lazy run-scoped artifact discovery with explicit cache invalidation. */
export class CIArtifactDetailService {
  private readonly cache = new Map<string, CIArtifactDetailResult>();

  constructor(
    private readonly api: Pick<GiteaActionsDetailApi, "listWorkflowArtifacts">,
  ) {}

  async resolveRunArtifacts(
    repoInfo: RepoInfo,
    runId: number,
  ): Promise<CIArtifactDetailResult> {
    const key = artifactCacheKey(repoInfo, runId);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const response = await this.api.listWorkflowArtifacts(repoInfo, runId);
    const result = normalizeArtifactDetails(response.artifacts);
    this.cache.set(key, result);
    return result;
  }

  invalidateRun(repoInfo: RepoInfo, runId: number): void {
    this.cache.delete(artifactCacheKey(repoInfo, runId));
  }

  invalidateRepo(repoInfo: RepoInfo): void {
    const prefix = `${repoInfo.key}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export function artifactCacheKey(
  repoInfo: Pick<RepoInfo, "key">,
  runId: number,
): string {
  return `${repoInfo.key}:${runId}`;
}
