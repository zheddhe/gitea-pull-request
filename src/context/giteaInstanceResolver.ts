export interface GiteaTransportMapping {
  host: string;
  port?: number;
}

export interface GiteaServerConfiguration {
  url: string;
  label?: string;
  transports?: GiteaTransportMapping[];
}

export type GitRemoteTransport =
  | {
      kind: "https";
      host: string;
      port?: number;
      owner: string;
      repo: string;
    }
  | {
      kind: "ssh";
      host: string;
      port?: number;
      user?: string;
      owner: string;
      repo: string;
    };

export interface EffectiveSshIdentity {
  host: string;
  port?: number;
  user?: string;
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

export function normalizeGiteaInstanceUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();

    // URL already removes explicit default ports. Preserve custom ports and
    // intentional base paths, but collapse equivalent trailing slashes.
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const normalized = url.toString().replace(/\/$/, "");
    return normalized;
  } catch {
    return undefined;
  }
}

export function parseGitRemote(url: string): GitRemoteTransport | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const path = repositoryPath(parsed.pathname);
      if (!path) return undefined;
      return {
        kind: "https",
        host: parsed.hostname.toLowerCase(),
        port: parsed.port ? parsePort(parsed.port) : undefined,
        owner: path.owner,
        repo: path.repo,
      };
    } catch {
      return undefined;
    }
  }

  if (/^ssh:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const path = repositoryPath(parsed.pathname);
      if (!path) return undefined;
      return {
        kind: "ssh",
        host: parsed.hostname.toLowerCase(),
        port: parsed.port ? parsePort(parsed.port) : undefined,
        user: parsed.username || undefined,
        owner: path.owner,
        repo: path.repo,
      };
    } catch {
      return undefined;
    }
  }

  // SCP-like SSH syntax: [user@]host:owner/repo.git. Deliberately require a
  // repository path after ':' so Windows drive paths are not classified as SSH.
  const scpLike = trimmed.match(/^(?:([^@/:]+)@)?([^/:]+):([^/]+)\/(.+)$/);
  if (scpLike) {
    const [, user, rawHost, owner, rawRepo] = scpLike;
    const repo = stripGitSuffix(rawRepo);
    if (!owner || !repo) return undefined;
    return {
      kind: "ssh",
      host: rawHost.toLowerCase(),
      user: user || undefined,
      owner,
      repo,
    };
  }

  return undefined;
}

export function parseSshGOutput(output: string): EffectiveSshIdentity | undefined {
  let host: string | undefined;
  let port: number | undefined;
  let user: string | undefined;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(" ");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;
    if (key === "hostname") host = value.toLowerCase();
    else if (key === "port") port = parsePort(value);
    else if (key === "user") user = value;
  }

  return host ? { host, port, user } : undefined;
}

export function resolveRemoteToGiteaInstance(
  remote: GitRemoteTransport,
  servers: readonly GiteaServerConfiguration[],
  options: {
    effectiveSsh?: EffectiveSshIdentity;
    legacyServerUrlOverride?: string;
  } = {},
): string | undefined {
  const normalizedServers = servers
    .map((server) => {
      const url = normalizeGiteaInstanceUrl(server.url);
      return url ? { ...server, url } : undefined;
    })
    .filter((server): server is GiteaServerConfiguration => !!server);

  const transportHost =
    remote.kind === "ssh" && options.effectiveSsh?.host
      ? options.effectiveSsh.host.toLowerCase()
      : remote.host.toLowerCase();
  const transportPort =
    remote.kind === "ssh" && options.effectiveSsh?.port !== undefined
      ? options.effectiveSsh.port
      : remote.port;

  const directMatches = normalizedServers.filter((server) => {
    const identity = instanceTransportIdentity(server.url);
    if (!identity || identity.host !== transportHost) return false;

    // HTTPS uses the API/web transport itself, so a custom port is significant.
    // SSH is a distinct transport and may legitimately use 22/2222 while the
    // same Gitea instance is served over HTTPS 443.
    if (remote.kind === "https") {
      return effectiveHttpsPort(identity) === (transportPort ?? 443);
    }
    return true;
  });
  const direct = uniqueServer(directMatches);
  if (direct) return direct.url;
  if (directMatches.length > 1) return undefined;

  const mappedMatches = normalizedServers.filter((server) =>
    (server.transports ?? []).some((mapping) => {
      if (mapping.host.trim().toLowerCase() !== transportHost) return false;
      return mapping.port === undefined || mapping.port === transportPort;
    }),
  );
  const mapped = uniqueServer(mappedMatches);
  if (mapped) return mapped.url;
  if (mappedMatches.length > 1) return undefined;

  const explicitlyConfiguredAsGitea = normalizedServers.some((server) => {
    const identity = instanceTransportIdentity(server.url);
    return identity?.host === transportHost;
  });
  if (
    KNOWN_NON_GITEA_FORGE_HOSTS.has(transportHost) &&
    !explicitlyConfiguredAsGitea
  ) {
    return undefined;
  }

  // Compatibility only: preserve the historical global override when no
  // deterministic configured/authenticated mapping exists. It must never
  // override the public-forge exclusion above.
  const legacy = options.legacyServerUrlOverride
    ? normalizeGiteaInstanceUrl(options.legacyServerUrlOverride)
    : undefined;
  return legacy;
}

export function isKnownNonGiteaForgeHost(host: string): boolean {
  return KNOWN_NON_GITEA_FORGE_HOSTS.has(host.trim().toLowerCase());
}

function repositoryPath(pathname: string): { owner: string; repo: string } | undefined {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return undefined;
  const repo = stripGitSuffix(segments.at(-1) ?? "");
  const owner = segments.at(-2) ?? "";
  return owner && repo ? { owner, repo } : undefined;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function parsePort(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : undefined;
}

function instanceTransportIdentity(
  serverUrl: string,
): { host: string; port?: number; protocol: string } | undefined {
  try {
    const parsed = new URL(serverUrl);
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port ? parsePort(parsed.port) : undefined,
      protocol: parsed.protocol,
    };
  } catch {
    return undefined;
  }
}

function effectiveHttpsPort(identity: {
  port?: number;
  protocol: string;
}): number {
  if (identity.port !== undefined) return identity.port;
  return identity.protocol === "http:" ? 80 : 443;
}

function uniqueServer(
  servers: readonly GiteaServerConfiguration[],
): GiteaServerConfiguration | undefined {
  if (servers.length !== 1) return undefined;
  return servers[0];
}
