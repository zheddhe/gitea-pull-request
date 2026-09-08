export type GiteaCapability =
  | "identity.read"
  | "repository.read"
  | "repository.write"
  | "issues.read"
  | "issues.write"
  | "actions.read"
  | "actions.write";

export type CapabilityState = "unknown" | "verified" | "denied" | "unsupported";

export interface CapabilitySnapshot {
  capability: GiteaCapability;
  state: CapabilityState;
}

const ALL_CAPABILITIES: readonly GiteaCapability[] = [
  "identity.read",
  "repository.read",
  "repository.write",
  "issues.read",
  "issues.write",
  "actions.read",
  "actions.write",
];

/**
 * Runtime-observed capability state, isolated per canonical Gitea instance.
 *
 * States are evidence-based. PAT scopes are never treated as proof of effective
 * repository/user authorization.
 */
export class CapabilityRegistry {
  private readonly states = new Map<string, Map<GiteaCapability, CapabilityState>>();

  get(serverUrl: string, capability: GiteaCapability): CapabilityState {
    return this.states.get(serverUrl)?.get(capability) ?? "unknown";
  }

  markVerified(serverUrl: string, capability: GiteaCapability): void {
    this.set(serverUrl, capability, "verified");
  }

  markDenied(serverUrl: string, capability: GiteaCapability): void {
    this.set(serverUrl, capability, "denied");
  }

  markUnsupported(serverUrl: string, capability: GiteaCapability): void {
    this.set(serverUrl, capability, "unsupported");
  }

  reset(serverUrl: string): void {
    this.states.delete(serverUrl);
  }

  snapshot(serverUrl: string): CapabilitySnapshot[] {
    return ALL_CAPABILITIES.map((capability) => ({
      capability,
      state: this.get(serverUrl, capability),
    }));
  }

  private set(
    serverUrl: string,
    capability: GiteaCapability,
    state: CapabilityState,
  ): void {
    let instance = this.states.get(serverUrl);
    if (!instance) {
      instance = new Map();
      this.states.set(serverUrl, instance);
    }
    instance.set(capability, state);
  }
}

/**
 * Extension-lifetime registry shared by API/diagnostic surfaces.
 * It contains no credential material and is intentionally not persisted.
 */
export const capabilityRegistry = new CapabilityRegistry();

export function capabilityForRequest(
  path: string,
  method = "GET",
): GiteaCapability | undefined {
  const normalizedMethod = method.toUpperCase();
  const write = normalizedMethod !== "GET" && normalizedMethod !== "HEAD";
  const pathOnly = path.split("?", 1)[0];

  if (pathOnly === "/user" || pathOnly.startsWith("/user/")) {
    return "identity.read";
  }

  if (/^\/repos\/[^/]+\/[^/]+\/actions(?:\/|$)/.test(pathOnly)) {
    return write ? "actions.write" : "actions.read";
  }

  if (/^\/repos\/[^/]+\/[^/]+\/issues(?:\/|$)/.test(pathOnly)) {
    return write ? "issues.write" : "issues.read";
  }

  if (pathOnly.startsWith("/repos/")) {
    return write ? "repository.write" : "repository.read";
  }

  return undefined;
}
