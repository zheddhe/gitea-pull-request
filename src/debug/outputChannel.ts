import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function initOutputChannel(): vscode.OutputChannel {
  channel = vscode.window.createOutputChannel("Gitea Pull Request");
  return channel;
}

export function getOutputChannel(): vscode.OutputChannel | undefined {
  return channel;
}

export function log(message: string): void {
  channel?.appendLine(new Date().toISOString() + " " + message);
}
