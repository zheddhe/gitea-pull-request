import { AuthManager } from "../auth/authManager";
import { capabilityRegistry } from "../auth/capabilityRegistry";
import type { RepoInfo } from "../context/repoManager";
import {
  classifyHttpFailure,
  GiteaApiError,
  sanitizeGiteaErrorDetail,
} from "./giteaApiError";
import type { GiteaLabel, GiteaMilestone, GiteaUser } from "./types";

/** Repository-scoped metadata shared by issue and pull-request authoring. */
export class RepositoryMetadataApi {
  constructor(private readonly auth: AuthManager) {}

  async listAssignees(repoInfo: RepoInfo): Promise<GiteaUser[]> {
    return this.get<GiteaUser[]>(repoInfo, "/assignees");
  }

  async listLabels(repoInfo: RepoInfo): Promise<GiteaLabel[]> {
    return this.get<GiteaLabel[]>(repoInfo, "/labels?limit=100");
  }

  async listMilestones(repoInfo: RepoInfo): Promise<GiteaMilestone[]> {
    return this.get<GiteaMilestone[]>(repoInfo, "/milestones?state=open&limit=100");
  }

  private async get<T>(repoInfo: RepoInfo, suffix: string): Promise<T> {
    const { serverUrl, owner, repo } = repoInfo;
    const session = await this.auth.getSession(serverUrl);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
    if (!session) {
      throw new GiteaApiError({ kind: "unauthenticated", serverUrl, path });
    }

    let response: Response;
    try {
      response = await fetch(`${serverUrl}/api/v1${path}`, {
        headers: { Authorization: `token ${session.token}` },
      });
    } catch (cause) {
      throw new GiteaApiError({
        kind: "transient",
        serverUrl,
        path,
        detail: "Network request failed",
        cause,
      });
    }
    if (!response.ok) {
      const kind = classifyHttpFailure(response.status);
      if (kind === "authorization") {
        capabilityRegistry.markDenied(serverUrl, "repository.read");
      }
      throw new GiteaApiError({
        kind,
        serverUrl,
        path,
        status: response.status,
        statusText: response.statusText,
        detail: sanitizeGiteaErrorDetail(await response.text()),
      });
    }
    capabilityRegistry.markVerified(serverUrl, "repository.read");
    return (await response.json()) as T;
  }
}