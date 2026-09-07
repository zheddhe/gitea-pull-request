import type { GiteaActionArtifactsResponse } from "../../../api/types";
import type { AuthManager } from "../../../auth/authManager";
import type { RepoInfo } from "../../../context/repoManager";

/**
 * Narrow Actions detail client kept separate from the broad repository client.
 * This surface is intentionally read-only in 9.4-A/B; artifact download is added
 * later as an explicit user-initiated operation in 9.4-C.
 */
export class GiteaActionsDetailApi {
  constructor(private readonly auth: Pick<AuthManager, "getSession">) {}

  async listWorkflowArtifacts(
    repoInfo: RepoInfo,
    runId: number,
  ): Promise<GiteaActionArtifactsResponse> {
    const session = await this.auth.getSession(repoInfo.serverUrl);
    if (!session) {
      throw new Error(
        `Not authenticated to ${repoInfo.serverUrl}. Use "Gitea: Sign In" to authenticate.`,
      );
    }

    const response = await fetch(
      `${repoInfo.serverUrl}/api/v1${workflowArtifactsPath(repoInfo, runId)}`,
      {
        headers: { Authorization: `token ${session.token}` },
      },
    );
    if (!response.ok) {
      const text = await response.text();
      let detail = "";
      try {
        const body = text ? JSON.parse(text) : undefined;
        detail = body?.message ? ` — ${body.message}` : "";
      } catch {
        detail = text ? ` — ${text}` : "";
      }
      throw new Error(
        `Gitea API error: ${response.status} ${response.statusText}${detail}`,
      );
    }

    if (response.status === 204) return { artifacts: [], total_count: 0 };
    const body = await response.text();
    if (!body.trim()) return { artifacts: [], total_count: 0 };
    return JSON.parse(body) as GiteaActionArtifactsResponse;
  }
}

export function workflowArtifactsPath(
  repoInfo: Pick<RepoInfo, "owner" | "repo">,
  runId: number,
): string {
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error(`Invalid workflow run id: ${runId}`);
  }
  return `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/runs/${runId}/artifacts`;
}
