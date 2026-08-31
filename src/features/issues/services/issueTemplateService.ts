import { AuthManager } from "../../../auth/authManager";
import type { RepoInfo } from "../../../context/repoManager";
import { parseIssueTemplate, type IssueTemplate } from "../domain/issueTemplate";

interface RepositoryInfoResponse {
  default_branch?: string;
}

interface RepositoryContentEntry {
  name: string;
  path: string;
  type: string;
  content?: string;
  encoding?: string;
}

export interface IssueTemplateDiscovery {
  defaultBranch: string;
  templates: IssueTemplate[];
}

export class IssueTemplateService {
  static readonly directory = ".gitea/ISSUE_TEMPLATE";

  constructor(private readonly auth: AuthManager) {}

  async discover(repoInfo: RepoInfo): Promise<IssueTemplateDiscovery> {
    const repository = await this.get<RepositoryInfoResponse>(repoInfo, "");
    const defaultBranch = repository.default_branch?.trim();
    if (!defaultBranch) {
      throw new Error(`Gitea did not report a default branch for ${repoInfo.label}.`);
    }

    const entries = await this.getDirectory(repoInfo, defaultBranch);
    const candidates = entries.filter(
      (entry) => entry.type === "file" && /\.md$/i.test(entry.name),
    );

    const templates = (
      await Promise.all(
        candidates.map(async (entry) => {
          try {
            const source = await this.getFile(repoInfo, defaultBranch, entry.path);
            return parseIssueTemplate(entry.path, source);
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((template): template is IssueTemplate => !!template);

    return {
      defaultBranch,
      templates: templates.sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  private async getDirectory(
    repoInfo: RepoInfo,
    branch: string,
  ): Promise<RepositoryContentEntry[]> {
    try {
      return await this.get<RepositoryContentEntry[]>(
        repoInfo,
        `/contents/${encodeURIComponent(IssueTemplateService.directory)}?ref=${encodeURIComponent(branch)}`,
      );
    } catch (error) {
      if ((error as Error).message.includes("Gitea API error: 404")) return [];
      throw error;
    }
  }

  private async getFile(
    repoInfo: RepoInfo,
    branch: string,
    path: string,
  ): Promise<string> {
    const data = await this.get<RepositoryContentEntry>(
      repoInfo,
      `/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    );
    if (data.encoding === "base64" && data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return data.content ?? "";
  }

  private async get<T>(repoInfo: RepoInfo, suffix: string): Promise<T> {
    const { serverUrl, owner, repo } = repoInfo;
    const session = await this.auth.getSession(serverUrl);
    if (!session) throw new Error(`Not authenticated to ${serverUrl}.`);

    const response = await fetch(
      `${serverUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`,
      { headers: { Authorization: `token ${session.token}` } },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Gitea API error: ${response.status} ${response.statusText}${message ? ` — ${message}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }
}
