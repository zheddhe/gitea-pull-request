import type { AuthManager } from "../../../auth/authManager";
import type { GiteaCombinedStatus } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";
import type {
  BranchMergePolicy,
  RepositoryMergeSettings,
} from "../domain/reviewPullRequestModel";

const READINESS_REQUEST_TIMEOUT_MS = 8000;

export class PullRequestReviewApi {
  constructor(private readonly auth: AuthManager) {}

  async getCombinedStatus(
    repoInfo: RepoInfo,
    ref: string,
  ): Promise<GiteaCombinedStatus> {
    return this.request<GiteaCombinedStatus>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${encodeURIComponent(ref)}/status`,
    );
  }

  async getRepositoryMergeSettings(
    repoInfo: RepoInfo,
  ): Promise<RepositoryMergeSettings> {
    return this.request<RepositoryMergeSettings>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}`,
    );
  }

  async getBranchMergePolicy(
    repoInfo: RepoInfo,
    branch: string,
  ): Promise<BranchMergePolicy> {
    return this.request<BranchMergePolicy>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${encodeURIComponent(branch)}`,
    );
  }

  private async request<T>(repoInfo: RepoInfo, path: string): Promise<T> {
    const session = await this.auth.getSession(repoInfo.serverUrl);
    if (!session) {
      throw new Error(`Not authenticated to ${repoInfo.serverUrl}.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READINESS_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    log(`[review-api] GET ${repoInfo.label} ${path}`);

    try {
      const response = await fetch(`${repoInfo.serverUrl}/api/v1${path}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `token ${session.token}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Gitea API error: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
        );
      }

      log(`[review-api] ${path} -> ${response.status} in ${Date.now() - startedAt}ms`);
      return (await response.json()) as T;
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? `request timed out after ${READINESS_REQUEST_TIMEOUT_MS}ms`
          : (error as Error).message;
      log(`[review-api] ${path} failed: ${reason}`);
      throw new Error(reason);
    } finally {
      clearTimeout(timeout);
    }
  }
}
