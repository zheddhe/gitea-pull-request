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
