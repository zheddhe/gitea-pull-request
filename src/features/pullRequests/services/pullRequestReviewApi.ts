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
    const status = await this.request<GiteaCombinedStatus>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${encodeURIComponent(ref)}/status`,
    );

    const statuses = Array.isArray(status?.statuses)
      ? status.statuses.filter(Boolean).map((item) => ({
          ...item,
          state: normalizeStatusState(item?.state),
          context: typeof item?.context === "string" ? item.context : "",
          description:
            typeof item?.description === "string" ? item.description : "",
          target_url: normalizeTargetUrl(repoInfo.serverUrl, item?.target_url),
        }))
      : [];

    const normalized: GiteaCombinedStatus = {
      ...status,
      state: normalizeStatusState(status?.state),
      statuses,
      total_count:
        typeof status?.total_count === "number" ? status.total_count : statuses.length,
    };
    log(
      `[review-api] normalized combined status state=${normalized.state} checks=${statuses.length}`,
    );
    return normalized;
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
    const reviews = await this.request<GiteaReview[]>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${number}/reviews`,
    );
    const normalized = Array.isArray(reviews)
      ? reviews.filter(Boolean).map((review) => ({
          ...review,
          body: typeof review.body === "string" ? review.body : "",
          submitted_at:
            typeof review.submitted_at === "string" ? review.submitted_at : "",
          stale: review.stale === true,
          user: review.user
            ? {
                ...review.user,
                login:
                  typeof review.user.login === "string" ? review.user.login : "",
              }
            : ({ login: "", id: 0, full_name: "", email: "", avatar_url: "" } as GiteaReview["user"]),
        }))
      : [];
    log(`[review-api] normalized reviews count=${normalized.length}`);
    return normalized;
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

function normalizeStatusState(
  value: unknown,
): "pending" | "success" | "error" | "failure" | "warning" {
  switch (value) {
    case "success":
    case "error":
    case "failure":
    case "warning":
      return value;
    default:
      return "pending";
  }
}

function normalizeTargetUrl(serverUrl: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    return new URL(value, `${serverUrl.replace(/\/$/, "")}/`).toString();
  } catch {
    log(`[review-api] ignored invalid check target_url=${value}`);
    return "";
  }
}
