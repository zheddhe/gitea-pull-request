export type GiteaApiErrorKind =
  | "unauthenticated"
  | "authentication"
  | "authorization"
  | "transient"
  | "api";

export interface GiteaApiErrorOptions {
  kind: GiteaApiErrorKind;
  serverUrl: string;
  path?: string;
  status?: number;
  statusText?: string;
  detail?: string;
  cause?: unknown;
}

/**
 * Typed, sanitized failure contract shared by Gitea API consumers.
 *
 * Never include request headers, PAT values or raw request options in this
 * error. `detail` is a bounded server response message intended for user-facing
 * diagnostics and logs.
 */
export class GiteaApiError extends Error {
  readonly kind: GiteaApiErrorKind;
  readonly serverUrl: string;
  readonly path?: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly detail?: string;

  constructor(options: GiteaApiErrorOptions) {
    super(formatMessage(options));
    this.name = "GiteaApiError";
    this.kind = options.kind;
    this.serverUrl = options.serverUrl;
    this.path = options.path;
    this.status = options.status;
    this.statusText = options.statusText;
    this.detail = options.detail;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function classifyHttpFailure(status: number): GiteaApiErrorKind {
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "api";
}

export function sanitizeGiteaErrorDetail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let detail = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed?.message === "string") {
      detail = parsed.message.trim();
    }
  } catch {
    // Plain-text Gitea/proxy response; keep it after sanitization below.
  }

  // Defense in depth: avoid reflecting common credential/header formats even
  // if a reverse proxy or custom Gitea error page unexpectedly echoed them.
  detail = detail
    .replace(/authorization\s*:\s*[^\r\n]+/gi, "Authorization: [redacted]")
    .replace(/\btoken\s+[A-Za-z0-9._~+\/-]+/gi, "token [redacted]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]");

  const MAX_DETAIL_LENGTH = 500;
  if (detail.length > MAX_DETAIL_LENGTH) {
    detail = `${detail.slice(0, MAX_DETAIL_LENGTH)}…`;
  }
  return detail || undefined;
}

export function isGiteaApiError(error: unknown): error is GiteaApiError {
  return error instanceof GiteaApiError;
}

function formatMessage(options: GiteaApiErrorOptions): string {
  switch (options.kind) {
    case "unauthenticated":
      return `Not authenticated to ${options.serverUrl}. Use "Gitea: Sign In" to authenticate.`;
    case "authentication":
      return appendDetail(
        `Gitea authentication failed for ${options.serverUrl}${statusSuffix(options)}`,
        options.detail,
      );
    case "authorization":
      return appendDetail(
        `Gitea permission denied for ${options.serverUrl}${statusSuffix(options)}`,
        options.detail,
      );
    case "transient":
      return appendDetail(
        `Gitea temporarily unavailable at ${options.serverUrl}${statusSuffix(options)}`,
        options.detail,
      );
    case "api":
      return appendDetail(
        `Gitea API error for ${options.serverUrl}${statusSuffix(options)}`,
        options.detail,
      );
  }
}

function statusSuffix(options: GiteaApiErrorOptions): string {
  if (options.status === undefined) return "";
  return `: ${options.status}${options.statusText ? ` ${options.statusText}` : ""}`;
}

function appendDetail(message: string, detail?: string): string {
  return detail ? `${message} — ${detail}` : message;
}
