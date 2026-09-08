import type { AuthManager } from "../../../auth/authManager";
import {
  capabilityForRequest,
  capabilityRegistry,
} from "../../../auth/capabilityRegistry";
import {
  classifyHttpFailure,
  GiteaApiError,
  isGiteaApiError,
  sanitizeGiteaErrorDetail,
} from "../../../api/giteaApiError";
import type {
  GiteaCombinedStatus,
  GiteaComment,
  GiteaReview,
  GiteaReviewComment,
} from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { debug, trace, warn } from "../../../debug/outputChannel";
import {
  evaluateGiteaServerCapabilities,
  type GiteaServerCapabilities,
} from "../domain/giteaServerCapabilities";
import type {
  BranchMergePolicy,
  RepositoryMergeSettings,
} from "../domain/reviewPullRequestModel";

const REVIEW_REQUEST_TIMEOUT_MS = 8000;

type CommitStatusState =
  | "pending"
  | "success"
  | "error"
  | "failure"
  | "warning";

type RawStatusLike = Record<string, unknown> & {
  state?: unknown;
  status?: unknown;
  context?: unknown;
  description?: unknown;
  target_url?: unknown;
};

export class PullRequestReviewApi {
  private readonly capabilitiesByServer = new Map<string, GiteaServerCapabilities>();

  constructor(private readonly auth: AuthManager) {}

  async getServerCapabilities(repoInfo: RepoInfo): Promise<GiteaServerCapabilities> {
    const cached = this.capabilitiesByServer.get(repoInfo.serverUrl);
    if (cached) return cached;

    const result = await this.request<{ version?: string }>(repoInfo, "/version");
    const version = typeof result?.version === "string" ? result.version : "";
    const capabilities = evaluateGiteaServerCapabilities(version);
    this.capabilitiesByServer.set(repoInfo.serverUrl, capabilities);
    debug(
      `[review-api] capabilities server=${repoInfo.serverUrl} version=${version || "unknown"} inlineReviewResolution=${capabilities.inlineReviewResolution} inlineReviewReplies=${capabilities.inlineReviewReplies}`,
    );
    return capabilities;
  }

  async getCombinedStatus(repoInfo: RepoInfo, ref: string): Promise<GiteaCombinedStatus> {
    const status = await this.request<GiteaCombinedStatus & RawStatusLike>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${encodeURIComponent(ref)}/status`,
    );

    const rawStatuses = Array.isArray(status?.statuses)
      ? (status.statuses as unknown[]).filter(Boolean)
      : [];

    const statuses = rawStatuses.map((rawItem, index) => {
      const item = rawItem as RawStatusLike;
      const normalizedState = normalizeStatusState(item.state, item.status);
      const context = typeof item.context === "string" ? item.context : "";
      const description = typeof item.description === "string" ? item.description : "";

      trace(
        `[review-api] check index=${index} context=${JSON.stringify(context)} rawState=${formatLogValue(item.state)} rawStatus=${formatLogValue(item.status)} normalized=${normalizedState} description=${JSON.stringify(description)}`,
      );

      return {
        ...item,
        state: normalizedState,
        context,
        description,
        target_url: normalizeTargetUrl(repoInfo.serverUrl, item.target_url),
      } as GiteaCombinedStatus["statuses"][number];
    });

    const normalized: GiteaCombinedStatus = {
      ...status,
      state: normalizeStatusState(status?.state, status?.status),
      statuses,
      total_count:
        typeof status?.total_count === "number" ? status.total_count : statuses.length,
    };
    debug(
      `[review-api] combined-status repo=${repoInfo.label} ref=${ref} state=${normalized.state} checks=${statuses.length}`,
    );
    return normalized;
  }

  async getRepositoryMergeSettings(repoInfo: RepoInfo): Promise<RepositoryMergeSettings> {
    return this.request<RepositoryMergeSettings>(repoInfo, `/repos/${repoInfo.owner}/${repoInfo.repo}`);
  }

  async getBranchMergePolicy(repoInfo: RepoInfo, branch: string): Promise<BranchMergePolicy> {
    return this.request<BranchMergePolicy>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${encodeURIComponent(branch)}`,
    );
  }

  async listReviews(repoInfo: RepoInfo, number: number): Promise<GiteaReview[]> {
    const reviews = await this.request<GiteaReview[]>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${number}/reviews`,
    );
    const normalized = Array.isArray(reviews)
      ? reviews.filter(Boolean).map((review) => ({
          ...review,
          body: typeof review.body === "string" ? review.body : "",
          submitted_at: typeof review.submitted_at === "string" ? review.submitted_at : "",
          stale: review.stale === true,
          user: review.user
            ? {
                ...review.user,
                login: typeof review.user.login === "string" ? review.user.login : "",
              }
            : ({ login: "", id: 0, full_name: "", email: "", avatar_url: "" } as GiteaReview["user"]),
        }))
      : [];
    trace(`[review-api] reviews repo=${repoInfo.label} pr=#${number} count=${normalized.length}`);
    return normalized;
  }

  async addComment(repoInfo: RepoInfo, number: number, body: string): Promise<GiteaComment> {
    return this.request<GiteaComment>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${number}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
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
      { method: "POST", body: JSON.stringify({ event, body, comments: [] }) },
    );
  }

  async replyToReviewComment(
    repoInfo: RepoInfo,
    number: number,
    commentId: number,
    body: string,
  ): Promise<GiteaReviewComment> {
    const capabilities = await this.getServerCapabilities(repoInfo);
    if (!capabilities.inlineReviewReplies) {
      throw new Error(
        `Inline review replies require Gitea 1.27.0 or newer (server: ${capabilities.version || "unknown"}).`,
      );
    }
    return this.request<GiteaReviewComment>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${number}/comments/${commentId}/replies`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
  }

  async resolveReviewComment(repoInfo: RepoInfo, commentId: number): Promise<void> {
    await this.updateReviewCommentResolution(repoInfo, commentId, true);
  }

  async reopenReviewComment(repoInfo: RepoInfo, commentId: number): Promise<void> {
    await this.updateReviewCommentResolution(repoInfo, commentId, false);
  }

  private async updateReviewCommentResolution(
    repoInfo: RepoInfo,
    commentId: number,
    resolved: boolean,
  ): Promise<void> {
    const capabilities = await this.getServerCapabilities(repoInfo);
    if (!capabilities.inlineReviewResolution) {
      throw new Error(
        `Inline review resolve/reopen requires Gitea 1.26.0 or newer (server: ${capabilities.version || "unknown"}).`,
      );
    }
    await this.request<void>(
      repoInfo,
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/comments/${commentId}/${resolved ? "resolve" : "unresolve"}`,
      { method: "POST" },
    );
  }

  private async request<T>(
    repoInfo: RepoInfo,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    const capability = capabilityForRequest(path, method);
    const session = await this.auth.getSession(repoInfo.serverUrl);
    if (!session) {
      throw new GiteaApiError({ kind: "unauthenticated", serverUrl: repoInfo.serverUrl, path });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REVIEW_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    debug(`[review-api] request method=${method} repo=${repoInfo.label} path=${path}`);

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
        const detail = sanitizeGiteaErrorDetail(await response.text());
        const kind = classifyHttpFailure(response.status);
        if (capability && kind === "authorization") {
          capabilityRegistry.markDenied(repoInfo.serverUrl, capability);
        }
        throw new GiteaApiError({
          kind,
          serverUrl: repoInfo.serverUrl,
          path,
          status: response.status,
          statusText: response.statusText,
          detail,
        });
      }

      if (capability) capabilityRegistry.markVerified(repoInfo.serverUrl, capability);
      debug(
        `[review-api] response method=${method} path=${path} status=${response.status} durationMs=${Date.now() - startedAt}`,
      );

      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      let failure: Error;
      if (isGiteaApiError(error)) {
        failure = error;
      } else if (error instanceof Error && error.name === "AbortError") {
        failure = new GiteaApiError({
          kind: "transient",
          serverUrl: repoInfo.serverUrl,
          path,
          detail: `Request timed out after ${REVIEW_REQUEST_TIMEOUT_MS}ms`,
          cause: error,
        });
      } else {
        failure = new GiteaApiError({
          kind: "transient",
          serverUrl: repoInfo.serverUrl,
          path,
          detail: "Network request failed",
          cause: error,
        });
      }
      warn(`[review-api] request failed method=${method} path=${path}: ${failure.message}`);
      throw failure;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeStatusState(stateValue: unknown, statusValue?: unknown): CommitStatusState {
  for (const candidate of [stateValue, statusValue]) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toLowerCase();
    switch (normalized) {
      case "pending":
      case "success":
      case "error":
      case "failure":
      case "warning":
        return normalized;
    }
  }
  return "pending";
}

function formatLogValue(value: unknown): string {
  if (value === undefined) return "<undefined>";
  if (value === null) return "<null>";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTargetUrl(serverUrl: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value, `${serverUrl.replace(/\/$/, "")}/`).toString();
  } catch {
    trace(`[review-api] ignored invalid check target_url=${value}`);
    return "";
  }
}
