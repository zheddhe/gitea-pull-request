import type { GiteaActionArtifactsResponse } from "../../../api/types";
import type { AuthManager } from "../../../auth/authManager";
import type { RepoInfo } from "../../../context/repoManager";

/**
 * Narrow Actions detail client kept separate from the broad repository client.
 * Artifact bytes are retrieved only through an explicit user-initiated call.
 */
export class GiteaActionsDetailApi {
  constructor(private readonly auth: Pick<AuthManager, "getSession">) {}

  async listWorkflowArtifacts(
    repoInfo: RepoInfo,
    runId: number,
  ): Promise<GiteaActionArtifactsResponse> {
    const response = await this.authenticatedFetch(
      repoInfo,
      workflowArtifactsPath(repoInfo, runId),
    );
    if (response.status === 204) return { artifacts: [], total_count: 0 };
    const body = await response.text();
    if (!body.trim()) return { artifacts: [], total_count: 0 };
    return JSON.parse(body) as GiteaActionArtifactsResponse;
  }

  async downloadWorkflowArtifact(
    repoInfo: RepoInfo,
    artifactId: number,
  ): Promise<Uint8Array> {
    const response = await this.authenticatedFetch(
      repoInfo,
      workflowArtifactDownloadPath(repoInfo, artifactId),
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  private async authenticatedFetch(
    repoInfo: RepoInfo,
    path: string,
  ): Promise<Response> {
    const session = await this.auth.getSession(repoInfo.serverUrl);
    if (!session) {
      throw new Error(
        `Not authenticated to ${repoInfo.serverUrl}. Use "Gitea: Sign In" to authenticate.`,
      );
    }

    const response = await fetch(`${repoInfo.serverUrl}/api/v1${path}`, {
      headers: { Authorization: `token ${session.token}` },
      redirect: "follow",
    });
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
    return response;
  }
}

export function workflowArtifactsPath(
  repoInfo: Pick<RepoInfo, "owner" | "repo">,
  runId: number,
): string {
  assertPositiveId(runId, "workflow run");
  return `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/runs/${runId}/artifacts`;
}

export function workflowArtifactDownloadPath(
  repoInfo: Pick<RepoInfo, "owner" | "repo">,
  artifactId: number,
): string {
  assertPositiveId(artifactId, "artifact");
  return `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/artifacts/${artifactId}/zip`;
}

function assertPositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label} id: ${value}`);
  }
}
