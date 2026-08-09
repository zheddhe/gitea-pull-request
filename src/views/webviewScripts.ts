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
  return `<script>${MARKED_SRC}</script>`;
}
