import { AuthManager } from "../auth/authManager";
import type { RepoInfo } from "../context/repoManager";
import type { GiteaLabel, GiteaMilestone, GiteaUser } from "./types";

export class PullRequestMetadataApi {
  constructor(private readonly auth: AuthManager) {}

  async listAssignees(repoInfo: RepoInfo): Promise<GiteaUser[]> {
    return this.get<GiteaUser[]>(repoInfo, "/assignees");
  }

  async listReviewerCandidates(repoInfo: RepoInfo): Promise<GiteaUser[]> {
    return this.get<GiteaUser[]>(repoInfo, "/collaborators");
  }

  async listLabels(repoInfo: RepoInfo): Promise<GiteaLabel[]> {
    return this.get<GiteaLabel[]>(repoInfo, "/labels?limit=100");
  }

  async listMilestones(repoInfo: RepoInfo): Promise<GiteaMilestone[]> {
    return this.get<GiteaMilestone[]>(repoInfo, "/milestones?state=open&limit=100");
  }

  async requestReviewers(
    repoInfo: RepoInfo,
    pullRequestNumber: number,
    reviewers: string[],
  ): Promise<void> {
    if (reviewers.length === 0) {
      return;
    }

    const { serverUrl, owner, repo } = repoInfo;
    const session = await this.auth.getSession(serverUrl);
    if (!session) {
      throw new Error(`Not authenticated to ${serverUrl}.`);
    }

    const response = await fetch(
      `${serverUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullRequestNumber}/requested_reviewers`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `token ${session.token}`,
        },
        body: JSON.stringify({ reviewers, team_reviewers: [] }),
      },
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Gitea reviewer request failed: ${response.status} ${response.statusText}${message ? ` — ${message}` : ""}`,
      );
    }
  }

  private async get<T>(repoInfo: RepoInfo, suffix: string): Promise<T> {
    const { serverUrl, owner, repo } = repoInfo;
    const session = await this.auth.getSession(serverUrl);
    if (!session) {
      throw new Error(`Not authenticated to ${serverUrl}.`);
    }

    const response = await fetch(
      `${serverUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`,
      { headers: { Authorization: `token ${session.token}` } },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Gitea metadata request failed: ${response.status} ${response.statusText}${message ? ` — ${message}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }
}
