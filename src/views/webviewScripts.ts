import * as fs from "fs";
import * as path from "path";

// Read marked.umd.js at module load time — it's static and won't change.
// At runtime __dirname is "out/views/", so going up two levels reaches the
// project root where node_modules lives.
const MARKED_SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "node_modules", "marked", "lib", "marked.umd.js"),
  "utf-8",
);

/** Return an inline <script> containing the full marked library source */
export function getMarkedInlineScript(): string {
  // The marked UMD source contains backticks which would terminate the
  // outer template literal in renderHtml(). Escape them with \\` so the
  // template literal passes them through as literal backticks.
  const safe = MARKED_SRC.replace(/`/g, '\\`');
  return '<script>' + safe + '</script>';
}
