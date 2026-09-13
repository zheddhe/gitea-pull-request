export type ReviewDiffSide = "base" | "head";

export interface ReviewDiffAnchor {
  oldPosition: number;
  newPosition: number;
}

export interface ReviewDiffAnchorIndex {
  lines(path: string, side: ReviewDiffSide): number[];
  has(path: string, side: ReviewDiffSide, line: number): boolean;
  anchor(
    path: string,
    side: ReviewDiffSide,
    line: number,
  ): ReviewDiffAnchor | undefined;
}

interface MutableFileAnchors {
  base: Map<number, ReviewDiffAnchor>;
  head: Map<number, ReviewDiffAnchor>;
}

/**
 * Builds the exact set of file lines that can safely host a review comment
 * from a unified pull-request diff. Lines outside hunks are intentionally not
 * represented: the native editor must never guess or snap to a nearby anchor.
 *
 * Each representable line keeps its canonical old/new pair. Context lines are
 * represented on both sides with the same pair, while additions and deletions
 * keep the absent side at zero.
 */
export function buildReviewDiffAnchorIndex(rawDiff: string): ReviewDiffAnchorIndex {
  const files = new Map<string, MutableFileAnchors>();
  let currentPath: string | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of rawDiff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      currentPath = parseDiffPath(rawLine);
      if (currentPath && !files.has(currentPath)) {
        files.set(currentPath, { base: new Map(), head: new Map() });
      }
      oldLine = 0;
      newLine = 0;
      inHunk = false;
      continue;
    }

    if (!currentPath) continue;
    const anchors = files.get(currentPath)!;

    if (rawLine.startsWith("@@")) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) {
        oldLine = 0;
        newLine = 0;
        inHunk = false;
        continue;
      }
      oldLine = Number(match[1]) - 1;
      newLine = Number(match[2]) - 1;
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;
    if (rawLine.startsWith("\\")) continue;

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      newLine += 1;
      anchors.head.set(newLine, {
        oldPosition: 0,
        newPosition: newLine,
      });
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      oldLine += 1;
      anchors.base.set(oldLine, {
        oldPosition: oldLine,
        newPosition: 0,
      });
      continue;
    }
    if (rawLine.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
      const anchor = {
        oldPosition: oldLine,
        newPosition: newLine,
      };
      anchors.base.set(oldLine, anchor);
      anchors.head.set(newLine, anchor);
    }
  }

  return {
    lines(path, side) {
      return [...(files.get(path)?.[side].keys() ?? [])].sort(
        (left, right) => left - right,
      );
    },
    has(path, side, line) {
      return line > 0 && (files.get(path)?.[side].has(line) ?? false);
    },
    anchor(path, side, line) {
      if (line <= 0) return undefined;
      const anchor = files.get(path)?.[side].get(line);
      return anchor ? { ...anchor } : undefined;
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
