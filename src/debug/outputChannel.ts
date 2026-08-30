import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

export function initOutputChannel(): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel("Gitea Pull Request", { log: true });
  return channel;
}

export function getOutputChannel(): vscode.LogOutputChannel | undefined {
  return channel;
}

export function trace(message: string): void {
  channel?.trace(message);
}

export function debug(message: string): void {
  channel?.debug(message);
}

export function info(message: string): void {
  channel?.info(message);
}

export function warn(message: string): void {
  channel?.warn(message);
}

export function error(message: string | Error): void {
  channel?.error(message);
}

/**
 * Compatibility adapter for remaining legacy call sites. New code must use an
 * explicit level helper above. Keep every emitted line component-prefixed so
 * VS Code LogOutputChannel output remains searchable and consistent.
 */
export function log(message: string): void {
  const prUpdate = /^PR update: #(\d+)$/.exec(message);
  if (prUpdate) {
    debug(`[pr-detail] update pr=#${prUpdate[1]}`);
    return;
  }

  if (message.startsWith("PR unknown message:")) {
    warn(`[pr-detail] ${message}`);
    return;
  }
  if (message.startsWith("PR link rejected:")) {
    warn(`[pr-detail] ${message}`);
    return;
  }
  if (message.startsWith("PR Markdown renderer fallback:")) {
    warn(`[pr-detail] ${message}`);
    return;
  }

  info(message.startsWith("[") ? message : `[legacy] ${message}`);
}
