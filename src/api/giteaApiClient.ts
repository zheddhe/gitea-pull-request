import { AuthManager } from "../auth/authManager";
import type { RepoInfo } from "../context/repoManager";
import { debug, trace, warn } from "../debug/outputChannel";
import type {
  GiteaUser,
  GiteaPullRequest,
  GiteaComment,
  GiteaReview,
  GiteaFileDiff,
  GiteaCommit,
  GiteaCombinedStatus,
  GiteaWorkflowRun,
  GiteaWorkflowJob,
  GiteaWorkflow,
  GiteaIssue,
  GiteaReviewComment,
  PagedResult,
} from "./types";

export class GiteaApiClient {
  constructor(private readonly auth: AuthManager) {}

  private async request<T>(
    serverUrl: string,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const session = await this.auth.getSession(serverUrl);
    if (!session) {
      throw new Error(
        `Not authenticated to ${serverUrl}. Use "Gitea: Sign In" to authenticate.`,
      );
    }
    const url = `${serverUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `token ${session.token}`,
      ...((options.headers as Record<string, string>) ?? {}),
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      let details = "";
      try {
        const body = text ? JSON.parse(text) : undefined;
        details = body?.message ? ` — ${body.message}` : "";
      } catch {
        details = text ? ` — ${text}` : "";
      }
      throw new Error(
        `Gitea API error: ${response.status} ${response.statusText}${details}`,
      );
    }
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    if (!body.trim()) return undefined as T;
    return JSON.parse(body) as T;
  }

  private async requestText(serverUrl: string, path: string): Promise<string> {
    const session = await this.auth.getSession(serverUrl);
    if (!session) {
      throw new Error(
        `Not authenticated to ${serverUrl}. Use "Gitea: Sign In" to authenticate.`,
      );
    }
    const url = `${serverUrl}/api/v1${path}`;
    const response = await fetch(url, {
      headers: { Authorization: `token ${session.token}` },
    });
    if (!response.ok) {
      throw new Error(
        `Gitea API error: ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  async getCurrentUser(serverUrl: string): Promise<GiteaUser> {
    return this.request<GiteaUser>(serverUrl, "/user");
  }

  async listPullRequests(
    repoInfo: RepoInfo,
    state: "open" | "closed" = "open",
    page = 1,
    limit = 20,
  ): Promise<PagedResult<GiteaPullRequest>> {
    const { serverUrl, owner, repo } = repoInfo;
    const items = await this.request<GiteaPullRequest[]>(
      serverUrl,
      `/repos/${owner}/${repo}/pulls?state=${state}&page=${page}&limit=${limit}`,
    );
    return { items: items ?? [], hasMore: (items ?? []).length === limit, page };
  }

  async getPullRequest(repoInfo: RepoInfo, number: number): Promise<GiteaPullRequest> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaPullRequest>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}`);
  }

  async createPullRequest(
    repoInfo: RepoInfo,
    params: { title: string; body: string; head: string; base: string; assignees?: string[]; labels?: number[] },
  ): Promise<GiteaPullRequest> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaPullRequest>(serverUrl, `/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async mergePullRequest(
    repoInfo: RepoInfo,
    number: number,
    method: "merge" | "rebase" | "squash" = "merge",
    message?: string,
  ): Promise<void> {
    const { serverUrl, owner, repo } = repoInfo;
    await this.request<void>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}/merge`, {
      method: "POST",
      body: JSON.stringify({ Do: method, merge_message_field: message ?? "" }),
    });
  }

  async closePullRequest(repoInfo: RepoInfo, number: number): Promise<GiteaPullRequest> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaPullRequest>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    });
  }

  async reopenPullRequest(repoInfo: RepoInfo, number: number): Promise<GiteaPullRequest> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaPullRequest>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "open" }),
    });
  }

  async updatePullRequest(
    repoInfo: RepoInfo,
    number: number,
    params: { title?: string; body?: string; base?: string },
  ): Promise<GiteaPullRequest> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaPullRequest>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}`, {
      method: "PATCH",
      body: JSON.stringify(params),
    });
  }

  async listPRComments(repoInfo: RepoInfo, number: number): Promise<GiteaComment[]> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaComment[]>(serverUrl, `/repos/${owner}/${repo}/issues/${number}/comments`);
  }

  async addPRComment(repoInfo: RepoInfo, number: number, body: string): Promise<GiteaComment> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaComment>(serverUrl, `/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async updateComment(repoInfo: RepoInfo, commentId: number, body: string): Promise<GiteaComment> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaComment>(serverUrl, `/repos/${owner}/${repo}/issues/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
  }

  async listReviews(repoInfo: RepoInfo, number: number): Promise<GiteaReview[]> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaReview[]>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}/reviews`);
  }

  async createReview(
    repoInfo: RepoInfo,
    number: number,
    event: "APPROVED" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments?: Array<{ path: string; new_position: number; old_position: number; body: string }>,
  ): Promise<GiteaReview> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaReview>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      method: "POST",
      body: JSON.stringify({ event, body, comments: comments ?? [] }),
    });
  }

  async listAllPRReviewComments(repoInfo: RepoInfo, number: number): Promise<GiteaReviewComment[]> {
    const { serverUrl, owner, repo } = repoInfo;
    const reviews = await this.listReviews(repoInfo, number);
    const commentsByReview = await Promise.all(
      reviews.map(async (review) => {
        try {
          const comments = await this.request<GiteaReviewComment[]>(
            serverUrl,
            `/repos/${owner}/${repo}/pulls/${number}/reviews/${review.id}/comments`,
          );
          debug(`[pr-inline-api] repo=${repoInfo.label} pr=#${number} review=${review.id} comments=${comments?.length ?? 0}`);
          return comments ?? [];
        } catch (error) {
          warn(`[pr-inline-api] repo=${repoInfo.label} pr=#${number} review=${review.id} comments failed: ${(error as Error).message}`);
          return [];
        }
      }),
    );
    const comments = commentsByReview.flat().map((comment) => ({
      ...comment,
      new_position: comment.position,
      old_position: comment.original_position,
    }));
    debug(`[pr-inline-api] repo=${repoInfo.label} pr=#${number} reviews=${reviews.length} inlineComments=${comments.length}`);
    for (const comment of comments) {
      trace(`[pr-inline-api] comment=${comment.id} review=${comment.pull_request_review_id ?? "?"} path=${comment.path} position=${comment.position ?? 0} original_position=${comment.original_position ?? 0}`);
    }
    return comments;
  }

  async listPRFiles(repoInfo: RepoInfo, number: number): Promise<GiteaFileDiff[]> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaFileDiff[]>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}/files`);
  }

  async getPRRawDiff(repoInfo: RepoInfo, number: number): Promise<string> {
    const { serverUrl, owner, repo } = repoInfo;
    const session = await this.auth.getSession(serverUrl);
    if (!session) {
      throw new Error(`Not authenticated to ${serverUrl}. Use "Gitea: Sign In" to authenticate.`);
    }
    const url = `${serverUrl}/${owner}/${repo}/pulls/${number}.diff`;
    const resp = await fetch(url, { headers: { Authorization: `token ${session.token}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching diff`);
    return resp.text();
  }

  async listPRCommits(repoInfo: RepoInfo, number: number): Promise<GiteaCommit[]> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaCommit[]>(serverUrl, `/repos/${owner}/${repo}/pulls/${number}/commits`);
  }

  async getCombinedStatus(repoInfo: RepoInfo, sha: string): Promise<GiteaCombinedStatus> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaCombinedStatus>(serverUrl, `/repos/${owner}/${repo}/commits/${sha}/statuses`);
  }

  async listWorkflowRuns(repoInfo: RepoInfo, status?: string, page = 1, limit = 20): Promise<PagedResult<GiteaWorkflowRun>> {
    const { serverUrl, owner, repo } = repoInfo;
    const statusParam = status ? `&status=${status}` : "";
    const data = await this.request<{ workflow_runs: GiteaWorkflowRun[]; total_count: number }>(
      serverUrl,
      `/repos/${owner}/${repo}/actions/runs?page=${page}&limit=${limit}${statusParam}`,
    );
    const items = data?.workflow_runs ?? [];
    return { items, hasMore: items.length === limit, page };
  }

  async getWorkflowRun(repoInfo: RepoInfo, runId: number): Promise<GiteaWorkflowRun> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaWorkflowRun>(serverUrl, `/repos/${owner}/${repo}/actions/runs/${runId}`);
  }

  async listWorkflowJobs(repoInfo: RepoInfo, runId: number): Promise<GiteaWorkflowJob[]> {
    const { serverUrl, owner, repo } = repoInfo;
    const data = await this.request<{ jobs: GiteaWorkflowJob[] }>(serverUrl, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);
    return data?.jobs ?? [];
  }

  async getWorkflowJob(repoInfo: RepoInfo, jobId: number): Promise<GiteaWorkflowJob> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaWorkflowJob>(serverUrl, `/repos/${owner}/${repo}/actions/jobs/${jobId}`);
  }

  async getJobLogs(repoInfo: RepoInfo, jobId: number): Promise<string> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.requestText(serverUrl, `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`);
  }

  async rerunWorkflow(repoInfo: RepoInfo, runId: number): Promise<void> {
    const { serverUrl, owner, repo } = repoInfo;
    await this.request<void>(serverUrl, `/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, { method: "POST" });
  }

  async rerunWorkflowJob(
    repoInfo: RepoInfo,
    runId: number,
    jobId: number,
  ): Promise<void> {
    const { serverUrl, owner, repo } = repoInfo;
    await this.request<void>(
      serverUrl,
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs/${jobId}/rerun`,
      { method: "POST" },
    );
  }

  async cancelWorkflowRun(repoInfo: RepoInfo, runId: number): Promise<void> {
    const { serverUrl, owner, repo } = repoInfo;
    await this.request<void>(serverUrl, `/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, { method: "POST" });
  }

  async listWorkflows(repoInfo: RepoInfo): Promise<GiteaWorkflow[]> {
    const { serverUrl, owner, repo } = repoInfo;
    const data = await this.request<{ workflows: GiteaWorkflow[] }>(serverUrl, `/repos/${owner}/${repo}/actions/workflows`);
    return data?.workflows ?? [];
  }

  async listBranches(repoInfo: RepoInfo): Promise<string[]> {
    const { serverUrl, owner, repo } = repoInfo;
    const branches = await this.request<{ name: string }[]>(serverUrl, `/repos/${owner}/${repo}/branches`);
    return (branches ?? []).map((b) => b.name);
  }

  async getFileContents(repoInfo: RepoInfo, branch: string, path: string): Promise<string> {
    const { serverUrl, owner, repo } = repoInfo;
    const encodedPath = encodeURIComponent(path);
    const data = await this.request<{ content: string; encoding: string }>(
      serverUrl,
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`,
    );
    if (!data) throw new Error(`File not found: ${path} on branch ${branch}`);
    if (data.encoding === "base64") return Buffer.from(data.content, "base64").toString("utf-8");
    return data.content;
  }

  async listIssues(
    repoInfo: RepoInfo,
    state: "open" | "closed" = "open",
    page = 1,
    limit = 20,
  ): Promise<PagedResult<GiteaIssue>> {
    const { serverUrl, owner, repo } = repoInfo;
    const items = await this.request<GiteaIssue[]>(
      serverUrl,
      `/repos/${owner}/${repo}/issues?type=issues&state=${state}&page=${page}&limit=${limit}`,
    );
    const issues = (items ?? []).filter((i) => !i.pull_request);
    return { items: issues, hasMore: (items ?? []).length === limit, page };
  }

  async getIssue(repoInfo: RepoInfo, number: number): Promise<GiteaIssue> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaIssue>(serverUrl, `/repos/${owner}/${repo}/issues/${number}`);
  }

  async createIssue(
    repoInfo: RepoInfo,
    params: { title: string; body: string; assignees?: string[]; labels?: number[]; milestone?: number },
  ): Promise<GiteaIssue> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaIssue>(serverUrl, `/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async closeIssue(repoInfo: RepoInfo, number: number): Promise<GiteaIssue> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaIssue>(serverUrl, `/repos/${owner}/${repo}/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    });
  }

  async reopenIssue(repoInfo: RepoInfo, number: number): Promise<GiteaIssue> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaIssue>(serverUrl, `/repos/${owner}/${repo}/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "open" }),
    });
  }

  async updateIssue(
    repoInfo: RepoInfo,
    number: number,
    params: { title?: string; body?: string },
  ): Promise<GiteaIssue> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaIssue>(serverUrl, `/repos/${owner}/${repo}/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify(params),
    });
  }

  async addIssueComment(repoInfo: RepoInfo, number: number, body: string): Promise<GiteaComment> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaComment>(serverUrl, `/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async listIssueComments(repoInfo: RepoInfo, number: number): Promise<GiteaComment[]> {
    const { serverUrl, owner, repo } = repoInfo;
    return this.request<GiteaComment[]>(serverUrl, `/repos/${owner}/${repo}/issues/${number}/comments`) ?? [];
  }
}
