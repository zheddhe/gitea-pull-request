export type ReviewDiffSide = "base" | "head";

export interface ReviewDiffAnchor {
  oldPosition: number;
  newPosition: number;
}

export interface ReviewDiffAnchorIndex {
  lines(path: string, side: ReviewDiffSide, maxLine?: number): number[];
  has(path: string, side: ReviewDiffSide, line: number): boolean;
  anchor(
    path: string,
    side: ReviewDiffSide,
    line: number,
  ): ReviewDiffAnchor | undefined;
}

interface UnchangedSegment {
  oldStart: number;
  newStart: number;
  length?: number;
}

interface MutableFileAnchors {
  base: Map<number, ReviewDiffAnchor>;
  head: Map<number, ReviewDiffAnchor>;
  unchanged: UnchangedSegment[];
  nextOld: number;
  nextNew: number;
}

interface HunkHeader {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/**
 * Builds a safe canonical mapping between base/head file coordinates from a
 * unified pull-request diff.
 *
 * Lines explicitly represented by hunks keep exact anchors. Context lines use
 * both coordinates, additions use (0, new), and deletions use (old, 0).
 * Unchanged regions before, between, and after hunks are also mapped exactly
 * from the hunk boundaries, so the native editor can comment on the complete
 * changed file without snapping an anchor to a nearby diff line.
 */
export function buildReviewDiffAnchorIndex(rawDiff: string): ReviewDiffAnchorIndex {
  const files = new Map<string, MutableFileAnchors>();
  let currentPath: string | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  const finishFile = () => {
    if (!currentPath) return;
    const file = files.get(currentPath);
    if (!file) return;
    file.unchanged.push({ oldStart: file.nextOld, newStart: file.nextNew });
  };

  for (const rawLine of rawDiff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      finishFile();
      currentPath = parseDiffPath(rawLine);
      if (currentPath) {
        files.set(currentPath, {
          base: new Map(),
          head: new Map(),
          unchanged: [],
          nextOld: 1,
          nextNew: 1,
        });
      }
      oldLine = 0;
      newLine = 0;
      inHunk = false;
      continue;
    }

    if (!currentPath) continue;
    const file = files.get(currentPath)!;

    if (rawLine.startsWith("@@")) {
      const header = parseHunkHeader(rawLine);
      if (!header) {
        oldLine = 0;
        newLine = 0;
        inHunk = false;
        continue;
      }

      addGapBeforeHunk(file, header);
      oldLine = header.oldCount === 0 ? header.oldStart : header.oldStart - 1;
      newLine = header.newCount === 0 ? header.newStart : header.newStart - 1;
      file.nextOld = firstLineAfterHunk(header.oldStart, header.oldCount);
      file.nextNew = firstLineAfterHunk(header.newStart, header.newCount);
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;
    if (rawLine.startsWith("\\")) continue;

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      newLine += 1;
      file.head.set(newLine, {
        oldPosition: 0,
        newPosition: newLine,
      });
      continue;
    }
    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      oldLine += 1;
      file.base.set(oldLine, {
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
      file.base.set(oldLine, anchor);
      file.head.set(newLine, anchor);
    }
  }

  finishFile();

  const resolveAnchor = (
    path: string,
    side: ReviewDiffSide,
    line: number,
  ): ReviewDiffAnchor | undefined => {
    if (line <= 0) return undefined;
    const file = files.get(path);
    if (!file) return undefined;

    const explicit = file[side].get(line);
    if (explicit) return { ...explicit };

    for (const segment of file.unchanged) {
      const sideStart = side === "base" ? segment.oldStart : segment.newStart;
      if (line < sideStart) continue;
      const offset = line - sideStart;
      if (segment.length !== undefined && offset >= segment.length) continue;
      return {
        oldPosition: segment.oldStart + offset,
        newPosition: segment.newStart + offset,
      };
    }
    return undefined;
  };

  return {
    lines(path, side, maxLine) {
      const file = files.get(path);
      if (!file) return [];
      if (maxLine === undefined) {
        return [...file[side].keys()].sort((left, right) => left - right);
      }
      const result: number[] = [];
      for (let line = 1; line <= maxLine; line += 1) {
        if (resolveAnchor(path, side, line)) result.push(line);
      }
      return result;
    },
    has(path, side, line) {
      return resolveAnchor(path, side, line) !== undefined;
    },
    anchor(path, side, line) {
      return resolveAnchor(path, side, line);
    },
  };
}

function addGapBeforeHunk(file: MutableFileAnchors, header: HunkHeader): void {
  const oldEnd = header.oldCount === 0 ? header.oldStart : header.oldStart - 1;
  const newEnd = header.newCount === 0 ? header.newStart : header.newStart - 1;
  const oldLength = oldEnd - file.nextOld + 1;
  const newLength = newEnd - file.nextNew + 1;
  if (oldLength <= 0 && newLength <= 0) return;
  if (oldLength !== newLength || oldLength <= 0) return;
  file.unchanged.push({
    oldStart: file.nextOld,
    newStart: file.nextNew,
    length: oldLength,
  });
}

function firstLineAfterHunk(start: number, count: number): number {
  return start + (count === 0 ? 1 : count);
}

function parseHunkHeader(raw: string): HunkHeader | undefined {
  const match = raw.match(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
  );
  if (!match) return undefined;
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
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
