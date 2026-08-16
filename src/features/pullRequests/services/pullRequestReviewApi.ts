import type { AuthManager } from "../../../auth/authManager";
import type { GiteaCombinedStatus } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import type {
  BranchMergePolicy,
  RepositoryMergeSettings,
} from "../domain/reviewPullRequestModel";

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

    const response = await fetch(`${repoInfo.serverUrl}/api/v1${path}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${session.token}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Gitea API error: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }
}
