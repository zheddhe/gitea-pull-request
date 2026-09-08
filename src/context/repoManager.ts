import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  normalizeGiteaInstanceUrl,
  parseGitRemote,
  parseSshGOutput,
  resolveRemoteToGiteaInstance,
  type EffectiveSshIdentity,
  type GiteaServerConfiguration,
  type GiteaTransportMapping,
  type GitRemoteTransport,
} from "./giteaInstanceResolver";

const execFileAsync = promisify(execFile);

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
  label?: string;
  transports?: GiteaTransportMapping[];
}

export function parseRemoteUrl(
  url: string,
  rootPath: string,
  options: {
    serverUrlOverride?: string;
    knownServerUrls?: string[];
    configuredServers?: GiteaServerConfiguration[];
    effectiveSsh?: EffectiveSshIdentity;
  } = {},
): RepoInfo | undefined {
  const remote = parseGitRemote(url);
  if (!remote) return undefined;

  const servers = mergeServerConfigurations([
    ...(options.configuredServers ?? []),
    ...(options.knownServerUrls ?? []).map((serverUrl) => ({ url: serverUrl })),
  ]);
  const serverUrl = resolveRemoteToGiteaInstance(remote, servers, {
    effectiveSsh: options.effectiveSsh,
    legacyServerUrlOverride: options.serverUrlOverride,
  });
  if (!serverUrl) return undefined;

  return repositoryInfo(serverUrl, remote, rootPath);
}

/**
 * Repository detection is triggered by many VS Code Git state changes (fetch,
 * HEAD/status updates, remote refreshes, etc.). Most of those events do not
 * actually change the set of Gitea repositories. Keep repository-change events
 * semantic so downstream providers do not refresh on every Git state pulse.
 */
export function repositoryListsEqual(a: RepoInfo[], b: RepoInfo[]): boolean {
  if (a.length !== b.length) return false;

  const normalize = (repos: RepoInfo[]) =>
    [...repos]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((repo) =>
        [
          repo.key,
          repo.serverUrl,
          repo.owner,
          repo.repo,
          repo.rootPath,
          repo.currentBranch ?? "",
        ].join("\u0000"),
      );

  const left = normalize(a);
  const right = normalize(b);
  return left.every((value, index) => value === right[index]);
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
    const servers = mergeServerConfigurations([
      ...configuredServers
        .filter((server): server is ConfiguredServer & { url: string } =>
          !!server.url?.trim(),
        )
        .map((server) => ({
          url: server.url,
          label: server.label,
          transports: server.transports,
        })),
      ...this.authenticatedServerUrls().map((url) => ({ url })),
      ...(defaultServer ? [{ url: defaultServer }] : []),
    ]);

    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (gitExt && gitExt.isActive) {
      try {
        const gitApi = gitExt.exports.getAPI(1);
        // git.repositories includes every repository in a multi-root workspace.
        // Only remotes deterministically mapped to a Gitea instance are kept.
        for (const gitRepo of gitApi.repositories) {
          const remotes: Array<{
            name: string;
            fetchUrl?: string;
            pushUrl?: string;
          }> = gitRepo.state.remotes;
          const remote =
            remotes.find((candidate: { name: string }) => candidate.name === "origin") ??
            remotes[0];
          if (!remote) continue;

          const fallbackUrl = (remote.fetchUrl ?? remote.pushUrl ?? "").trim();
          if (!fallbackUrl) continue;

          const effectiveUrl = await resolveEffectiveGitRemoteUrl(
            gitRepo.rootUri.fsPath,
            remote.name,
            fallbackUrl,
            !remote.fetchUrl && !!remote.pushUrl,
          );
          const parsed = parseGitRemote(effectiveUrl);
          if (!parsed) continue;

          const effectiveSsh =
            parsed.kind === "ssh"
              ? await resolveEffectiveSshIdentity(parsed)
              : undefined;
          const serverUrl = resolveRemoteToGiteaInstance(parsed, servers, {
            effectiveSsh,
            legacyServerUrlOverride: serverUrlOverride,
          });
          if (!serverUrl) continue;

          const info = repositoryInfo(
            serverUrl,
            parsed,
            gitRepo.rootUri.fsPath,
          );
          if (seen.has(info.key)) continue;

          info.currentBranch = gitRepo.state.HEAD?.name;
          seen.add(info.key);
          found.push(info);
        }
      } catch {
        /* ignore repository detection errors */
      }
    }

    if (repositoryListsEqual(this._repos, found)) return;

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
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this._onDidChange.dispose();
  }
}

export async function resolveEffectiveGitRemoteUrl(
  rootPath: string,
  remoteName: string,
  fallbackUrl: string,
  pushOnly = false,
): Promise<string> {
  try {
    const args = ["-C", rootPath, "remote", "get-url"];
    if (pushOnly) args.push("--push");
    args.push(remoteName);
    const { stdout } = await execFileAsync("git", args, {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim() || fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

export async function resolveEffectiveSshIdentity(
  remote: Extract<GitRemoteTransport, { kind: "ssh" }>,
): Promise<EffectiveSshIdentity> {
  const fallback: EffectiveSshIdentity = {
    host: remote.host,
    port: remote.port,
    user: remote.user,
  };

  try {
    const args = ["-G"];
    if (remote.port !== undefined) args.push("-p", String(remote.port));
    const target = remote.user ? `${remote.user}@${remote.host}` : remote.host;
    args.push(target);
    const { stdout } = await execFileAsync("ssh", args, {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 256 * 1024,
    });
    return parseSshGOutput(stdout) ?? fallback;
  } catch {
    return fallback;
  }
}

export function mergeServerConfigurations(
  servers: readonly GiteaServerConfiguration[],
): GiteaServerConfiguration[] {
  const merged = new Map<string, GiteaServerConfiguration>();
  for (const server of servers) {
    const url = normalizeGiteaInstanceUrl(server.url);
    if (!url) continue;
    const existing = merged.get(url);
    if (!existing) {
      merged.set(url, {
        url,
        label: server.label,
        transports: [...(server.transports ?? [])],
      });
      continue;
    }
    if (!existing.label && server.label) existing.label = server.label;
    const transportKeys = new Set(
      (existing.transports ?? []).map(transportKey),
    );
    for (const transport of server.transports ?? []) {
      if (!transportKeys.has(transportKey(transport))) {
        (existing.transports ??= []).push(transport);
        transportKeys.add(transportKey(transport));
      }
    }
  }
  return [...merged.values()];
}

function repositoryInfo(
  serverUrl: string,
  remote: GitRemoteTransport,
  rootPath: string,
): RepoInfo {
  return {
    serverUrl,
    owner: remote.owner,
    repo: remote.repo,
    rootPath,
    label: `${remote.owner}/${remote.repo}`,
    key: `${serverUrl}|${remote.owner}/${remote.repo}`,
  };
}

function transportKey(transport: GiteaTransportMapping): string {
  return `${transport.host.trim().toLowerCase()}:${transport.port ?? "*"}`;
}
