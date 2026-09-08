import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { debug, trace } from "../debug/outputChannel";
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
  label: string;
  key: string;
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

export function repositoryListsEqual(a: RepoInfo[], b: RepoInfo[]): boolean {
  if (a.length !== b.length) return false;
  const normalize = (repos: RepoInfo[]) =>
    [...repos]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((repo) =>
        [repo.key, repo.serverUrl, repo.owner, repo.repo, repo.rootPath, repo.currentBranch ?? ""].join("\u0000"),
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

  constructor(private readonly authenticatedServerUrls: () => string[] = () => []) {}

  async initialize(): Promise<void> {
    await this.detect();
    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (gitExt) {
      try {
        const gitApi = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
        this.disposables.push(
          gitApi.onDidOpenRepository(async () => {
            await this.detect();
            for (const r of gitApi.repositories) r.state.onDidChange(() => this.detect());
          }),
          gitApi.onDidCloseRepository(() => this.detect()),
        );
        for (const r of gitApi.repositories) {
          this.disposables.push(r.state.onDidChange(() => this.detect()));
        }
      } catch (error) {
        debug(`[repo] vscode.git unavailable: ${(error as Error).message}`);
      }
    }
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.detect()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("gitea.serverUrl") ||
          e.affectsConfiguration("gitea.servers") ||
          e.affectsConfiguration("gitea.defaultServer")
        ) this.detect();
      }),
    );
  }

  async detect(): Promise<void> {
    const found: RepoInfo[] = [];
    const seen = new Set<string>();
    const config = vscode.workspace.getConfiguration("gitea");
    const serverUrlOverride = config.get<string>("serverUrl")?.trim() || undefined;
    const configuredServers = config.get<ConfiguredServer[]>("servers") ?? [];
    const defaultServer = config.get<string>("defaultServer")?.trim();
    const servers = mergeServerConfigurations([
      ...configuredServers
        .filter((server): server is ConfiguredServer & { url: string } => !!server.url?.trim())
        .map((server) => ({ url: server.url, label: server.label, transports: server.transports })),
      ...this.authenticatedServerUrls().map((url) => ({ url })),
      ...(defaultServer ? [{ url: defaultServer }] : []),
    ]);

    const gitExt = vscode.extensions.getExtension("vscode.git");
    if (gitExt && gitExt.isActive) {
      try {
        const gitApi = gitExt.exports.getAPI(1);
        for (const gitRepo of gitApi.repositories) {
          const remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }> = gitRepo.state.remotes;
          const remote = remotes.find((candidate) => candidate.name === "origin") ?? remotes[0];
          if (!remote) {
            trace(`[repo] no remote root=${gitRepo.rootUri.fsPath}`);
            continue;
          }
          const fallbackUrl = (remote.fetchUrl ?? remote.pushUrl ?? "").trim();
          if (!fallbackUrl) continue;

          const effectiveUrl = await resolveEffectiveGitRemoteUrl(
            gitRepo.rootUri.fsPath,
            remote.name,
            fallbackUrl,
            !remote.fetchUrl && !!remote.pushUrl,
          );
          const parsed = parseGitRemote(effectiveUrl);
          if (!parsed) {
            trace(`[repo] unsupported remote root=${gitRepo.rootUri.fsPath} remote=${remote.name}`);
            continue;
          }

          const effectiveSsh = parsed.kind === "ssh" ? await resolveEffectiveSshIdentity(parsed) : undefined;
          const serverUrl = resolveRemoteToGiteaInstance(parsed, servers, {
            effectiveSsh,
            legacyServerUrlOverride: serverUrlOverride,
          });
          if (!serverUrl) {
            trace(`[repo] unmapped remote root=${gitRepo.rootUri.fsPath} host=${parsed.host}`);
            continue;
          }

          const info = repositoryInfo(serverUrl, parsed, gitRepo.rootUri.fsPath);
          if (seen.has(info.key)) continue;
          info.currentBranch = gitRepo.state.HEAD?.name;
          seen.add(info.key);
          found.push(info);
          debug(`[repo] mapped repo=${info.label} server=${info.serverUrl} branch=${info.currentBranch ?? "detached"}`);
        }
      } catch (error) {
        debug(`[repo] detection failed: ${(error as Error).message}`);
      }
    }

    if (repositoryListsEqual(this._repos, found)) return;
    debug(`[repo] repository set changed previous=${this._repos.length} current=${found.length}`);
    this._repos = found;
    this._onDidChange.fire(found);
  }

  getRepos(): RepoInfo[] { return this._repos; }
  get info(): RepoInfo | undefined { return this._repos[0]; }

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
  } catch (error) {
    trace(`[repo] git remote get-url fallback root=${rootPath} remote=${remoteName}: ${(error as Error).message}`);
    return fallbackUrl;
  }
}

export async function resolveEffectiveSshIdentity(
  remote: Extract<GitRemoteTransport, { kind: "ssh" }>,
): Promise<EffectiveSshIdentity> {
  const fallback: EffectiveSshIdentity = { host: remote.host, port: remote.port, user: remote.user };
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
    const resolved = parseSshGOutput(stdout) ?? fallback;
    trace(`[repo] ssh identity host=${remote.host} resolvedHost=${resolved.host} port=${resolved.port ?? "default"}`);
    return resolved;
  } catch (error) {
    trace(`[repo] ssh -G fallback host=${remote.host}: ${(error as Error).message}`);
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
      merged.set(url, { url, label: server.label, transports: [...(server.transports ?? [])] });
      continue;
    }
    if (!existing.label && server.label) existing.label = server.label;
    const transportKeys = new Set((existing.transports ?? []).map(transportKey));
    for (const transport of server.transports ?? []) {
      if (!transportKeys.has(transportKey(transport))) {
        (existing.transports ??= []).push(transport);
        transportKeys.add(transportKey(transport));
      }
    }
  }
  return [...merged.values()];
}

function repositoryInfo(serverUrl: string, remote: GitRemoteTransport, rootPath: string): RepoInfo {
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
