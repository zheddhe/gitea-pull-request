import type { AuthManager } from "../../../auth/authManager";
import type {
  GiteaCombinedStatus,
  GiteaComment,
  GiteaReview,
} from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";
import type {
  BranchMergePolicy,
  RepositoryMergeSettings,
} from "../domain/reviewPullRequestModel";

const REVIEW_REQUEST_TIMEOUT_MS = 8000;

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

  async listReviews(
    repoInfo: RepoInfo,
    number: number,
  ): Promise<GiteaReview[]> {
    return this.request<GiteaReview[]>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${number}/reviews`,
    );
  }

  async addComment(
    repoInfo: RepoInfo,
    number: number,
    body: string,
  ): Promise<GiteaComment> {
    return this.request<GiteaComment>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  }

  async createReview(
    repoInfo: RepoInfo,
    number: number,
    event: "APPROVED" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
  ): Promise<GiteaReview> {
    return this.request<GiteaReview>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${number}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({ event, body, comments: [] }),
      },
    );
  }

  private async request<T>(
    repoInfo: RepoInfo,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const session = await this.auth.getSession(repoInfo.serverUrl);
    if (!session) {
      throw new Error(`Not authenticated to ${repoInfo.serverUrl}.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REVIEW_REQUEST_TIMEOUT_MS,
    );
    const startedAt = Date.now();
    const method = options.method ?? "GET";
    log(`[review-api] ${method} ${repoInfo.label} ${path}`);

    try {
      const response = await fetch(`${repoInfo.serverUrl}/api/v1${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `token ${session.token}`,
          ...((options.headers as Record<string, string>) ?? {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Gitea API error: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
        );
      }

      log(
        `[review-api] ${method} ${path} -> ${response.status} in ${Date.now() - startedAt}ms`,
      );

      if (response.status === 204) {
        return undefined as T;
      }
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? `request timed out after ${REVIEW_REQUEST_TIMEOUT_MS}ms`
          : (error as Error).message;
      log(`[review-api] ${method} ${path} failed: ${reason}`);
      throw new Error(reason);
    } finally {
      clearTimeout(timeout);
    }
  }
}
