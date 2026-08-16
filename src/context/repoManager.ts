import * as vscode from "vscode";

export interface RepoInfo {
  serverUrl: string;
  owner: string;
  repo: string;
  currentBranch?: string;
  rootPath: string;
  label: string; // "owner/repo"
  key: string; // unique: "serverUrl|owner/repo"
}

interface ConfiguredServer {
  url?: string;
}

interface ParsedRemote {
  detectedServerUrl: string;
  owner: string;
  repo: string;
}

const KNOWN_NON_GITEA_FORGE_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
  "www.bitbucket.org",
  "dev.azure.com",
  "ssh.dev.azure.com",
]);

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function serverHost(value: string): string | undefined {
  try {
    return new URL(normalizeServerUrl(value)).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function parseRemote(url: string): ParsedRemote | undefined {
  const trimmed = url.trim();

  // https://[user[:pass]@]forge.example.com[:port]/owner/repo[.git]
  const httpsMatch = trimmed.match(
    /^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    const [, hostport, owner, repo] = httpsMatch;
    return {
      detectedServerUrl: `https://${hostport}`,
      owner,
      repo,
    };
  }

  // git@host:owner/repo[.git]
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, owner, repo] = sshMatch;
    return {
      detectedServerUrl: `https://${host}`,
      owner,
      repo,
    };
  }

  return undefined;
}

export function parseRemoteUrl(
  url: string,
  rootPath: string,
  options: {
    serverUrlOverride?: string;
    knownServerUrls?: string[];
  } = {},
): RepoInfo | undefined {
  const parsed = parseRemote(url);
  if (!parsed) {
    return undefined;
  }

  const detectedHost = serverHost(parsed.detectedServerUrl);
  if (!detectedHost) {
    return undefined;
  }

  const knownServerUrls = (options.knownServerUrls ?? [])
    .map(normalizeServerUrl)
    .filter(Boolean);
  const knownHosts = new Set(
    knownServerUrls
      .map(serverHost)
      .filter((host): host is string => !!host),
  );

  // A mixed workspace may contain GitHub/GitLab/Bitbucket/Azure repositories.
  // Never reinterpret a well-known non-Gitea forge as Gitea merely because a
  // global Gitea server override exists. This is the key coexistence guard.
  if (
    KNOWN_NON_GITEA_FORGE_HOSTS.has(detectedHost) &&
    !knownHosts.has(detectedHost)
  ) {
    return undefined;
  }

  const override = options.serverUrlOverride
    ? normalizeServerUrl(options.serverUrlOverride)
    : undefined;

  // Once at least one Gitea server is known, only auto-detect remotes for those
  // hosts. The explicit override remains a compatibility escape hatch for SSH
  // aliases whose git hostname differs from the Gitea web/API hostname.
  if (knownHosts.size > 0 && !knownHosts.has(detectedHost) && !override) {
    return undefined;
  }

  const serverUrl = override ?? normalizeServerUrl(parsed.detectedServerUrl);
  return {
    serverUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    rootPath,
    label: `${parsed.owner}/${parsed.repo}`,
    key: `${serverUrl}|${parsed.owner}/${parsed.repo}`,
  };
}

export class RepoManager implements vscode.Disposable {
  private _repos: RepoInfo[] = [];
  private _onDidChange = new vscode.EventEmitter<RepoInfo[]>();
  readonly onDidChange = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly authenticatedServerUrls: () => string[] = () => [],
  ) {}

  async initialize(): Promise<void> {
    await this.detect();

    // Watch VS Code git extension for repo open/close and HEAD changes.
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (gitExt) {
      try {
        const gitApi = (
          gitExt.isActive ? gitExt.exports : await gitExt.activate()
        ).getAPI(1);
        this.disposables.push(
          gitApi.onDidOpenRepository(async () => {
            await this.detect();
            for (const r of gitApi.repositories) {
              r.state.onDidChange(() => this.detect());
            }
          }),
          gitApi.onDidCloseRepository(() => this.detect()),
        );
        for (const r of gitApi.repositories) {
          this.disposables.push(r.state.onDidChange(() => this.detect()));
        }
      } catch {
        /* git ext unavailable */
      }
    }
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.detect()),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("gitea.serverUrl") ||
          e.affectsConfiguration("gitea.servers") ||
          e.affectsConfiguration("gitea.defaultServer")
        ) {
          this.detect();
        }
      }),
    );
  }

  async detect(): Promise<void> {
    const found: RepoInfo[] = [];
    const seen = new Set<string>();

    const config = vscode.workspace.getConfiguration("gitea");
    const serverUrlOverride =
      config.get<string>("serverUrl")?.trim() || undefined;
    const configuredServers = config.get<ConfiguredServer[]>("servers") ?? [];
    const defaultServer = config.get<string>("defaultServer")?.trim();
    const knownServerUrls = [
      ...this.authenticatedServerUrls(),
      ...configuredServers.map((server) => server.url ?? ""),
      defaultServer ?? "",
      serverUrlOverride ?? "",
    ].filter(Boolean);

    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (gitExt && gitExt.isActive) {
      try {
        const gitApi = gitExt.exports.getAPI(1);
        // git.repositories includes every repository in a multi-root workspace.
        // Only remotes classified as Gitea candidates are retained here.
        for (const gitRepo of gitApi.repositories) {
          const remotes: Array<{
            name: string;
            fetchUrl?: string;
            pushUrl?: string;
          }> = gitRepo.state.remotes;
          const remote =
            remotes.find((r: { name: string }) => r.name === "origin") ??
            remotes[0];
          if (!remote) {
            continue;
          }
          const url = (remote.fetchUrl ?? remote.pushUrl ?? "").trim();
          if (!url) {
            continue;
          }
          const info = parseRemoteUrl(url, gitRepo.rootUri.fsPath, {
            serverUrlOverride,
            knownServerUrls,
          });
          if (!info || seen.has(info.key)) {
            continue;
          }
          info.currentBranch = gitRepo.state.HEAD?.name;
          seen.add(info.key);
          found.push(info);
        }
      } catch {
        /* ignore repository detection errors */
      }
    }

    this._repos = found;
    this._onDidChange.fire(found);
  }

  getRepos(): RepoInfo[] {
    return this._repos;
  }

  /** First detected Gitea repo — for legacy single-repo code paths. */
  get info(): RepoInfo | undefined {
    return this._repos[0];
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this._onDidChange.dispose();
  }
}
