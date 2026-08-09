import * as vscode from "vscode";

/** Return a `<script>` tag that loads marked from node_modules into the webview */
export function getMarkedScriptTag(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
): string {
  const markedPath = vscode.Uri.joinPath(
    extensionUri,
    "node_modules",
    "marked",
    "lib",
    "marked.umd.js",
  );
  const markedUri = webview.asWebviewUri(markedPath);
  return `<script src="${markedUri}"></script>`;
}
