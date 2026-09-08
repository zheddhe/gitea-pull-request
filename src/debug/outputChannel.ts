import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

export function initOutputChannel(): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel("Gitea Pull Request", { log: true });
  return channel;
}

export function getOutputChannel(): vscode.LogOutputChannel | undefined {
  return channel;
}

/**
 * Defense-in-depth sanitization for every diagnostic surface.
 * Phase 9.3 already sanitizes typed API failures before they escape the API
 * boundary; this additionally prevents accidental credential leakage from
 * future or legacy call sites.
 */
export function sanitizeLogMessage(message: string): string {
  return message
    .replace(/(authorization\s*[:=]\s*)(?:token|bearer)\s+[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(?:token|bearer)\s+[A-Za-z0-9._~+\/-]+/gi, "token [REDACTED]")
    .replace(/([?&](?:access_token|token)=)[^&\s]+/gi, "$1[REDACTED]");
}

function sanitized(message: string): string {
  return sanitizeLogMessage(message);
}

export function trace(message: string): void {
  channel?.trace(sanitized(message));
}

export function debug(message: string): void {
  channel?.debug(sanitized(message));
}

export function info(message: string): void {
  channel?.info(sanitized(message));
}

export function warn(message: string): void {
  channel?.warn(sanitized(message));
}

export function error(message: string | Error): void {
  if (message instanceof Error) {
    channel?.error(new Error(sanitized(message.message)));
    return;
  }
  channel?.error(sanitized(message));
}

/**
 * Temporary compatibility boundary for remaining legacy call sites.
 *
 * It deliberately performs no text-based level inference: legacy diagnostics
 * are debug-only until their call sites are migrated to an explicit level.
 * No production code should add new calls to this helper.
 */
export function log(message: string): void {
  debug(message.startsWith("[") ? message : `[legacy] ${message}`);
}
