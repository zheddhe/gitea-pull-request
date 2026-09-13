export type ReviewDiffSide = "base" | "head";

export interface ReviewDiffAnchorIndex {
  lines(path: string, side: ReviewDiffSide): number[];
  has(path: string, side: ReviewDiffSide, line: number): boolean;
}

interface MutableFileAnchors {
  base: Set<number>;
  head: Set<number>;
}

/**
 * Builds the exact set of file lines that can safely host a review comment
 * from a unified pull-request diff. Lines outside hunks are intentionally not
 * represented: the native editor must never guess or snap to a nearby anchor.
 */
export function buildReviewDiffAnchorIndex(rawDiff: string): ReviewDiffAnchorIndex {
  const files = new Map<string, MutableFileAnchors>();
  let currentPath: string | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of rawDiff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      currentPath = parseDiffPath(rawLine);
      if (currentPath && !files.has(currentPath)) {
        files.set(currentPath, { base: new Set(), head: new Set() });
      }
      oldLine = 0;
      newLine = 0;
      continue;
    }

    if (!currentPath) continue;
    const anchors = files.get(currentPath)!;

    if (rawLine.startsWith("@@")) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) {
        oldLine = 0;
        newLine = 0;
        continue;
      }
      oldLine = Number(match[1]) - 1;
      newLine = Number(match[2]) - 1;
      continue;
    }

    if (oldLine === 0 && newLine === 0) continue;
    if (rawLine.startsWith("\\")) continue;

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      newLine += 1;
      anchors.head.add(newLine);
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      oldLine += 1;
      anchors.base.add(oldLine);
      continue;
    }
    if (rawLine.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
      anchors.base.add(oldLine);
      anchors.head.add(newLine);
    }
  }

  return {
    lines(path, side) {
      return [...(files.get(path)?.[side] ?? [])].sort((left, right) => left - right);
    },
    has(path, side, line) {
      return line > 0 && (files.get(path)?.[side].has(line) ?? false);
    },
  };
}

function parseDiffPath(header: string): string | undefined {
  const match = header.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return undefined;
  const path = unquoteGitPath(match[2].trim());
  return path || undefined;
}

function unquoteGitPath(path: string): string {
  if (!(path.startsWith('"') && path.endsWith('"'))) return path;
  try {
    return JSON.parse(path) as string;
  } catch {
    return path.slice(1, -1);
  }
}
