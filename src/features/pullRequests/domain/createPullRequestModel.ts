export function suggestTitleFromBranch(branch: string): string {
  const cleaned = branch
    .replace(/^refs\/heads\//, "")
    .replace(/^(feature|feat|fix|bugfix|hotfix|chore|docs|test|refactor)\//i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return branch;
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function draftTitle(title: string): string {
  const trimmed = title.trim();
  if (/^(WIP:|\[WIP\])/i.test(trimmed)) {
    return trimmed;
  }
  return `WIP: ${trimmed}`;
}

export function validBranchPair(baseBranch: string, headBranch: string): boolean {
  return Boolean(baseBranch && headBranch && baseBranch !== headBranch);
}

export interface BranchSelection {
  baseBranch: string;
  headBranch: string;
}

export function reconcileBranchSelection(
  branches: string[],
  previousBase: string,
  previousHead: string,
  preferredHead?: string,
): BranchSelection {
  if (branches.length < 2) {
    throw new Error("At least two branches are required.");
  }

  const headBranch = branches.includes(previousHead)
    ? previousHead
    : preferredHead && branches.includes(preferredHead)
      ? preferredHead
      : branches[0];

  if (branches.includes(previousBase) && previousBase !== headBranch) {
    return { baseBranch: previousBase, headBranch };
  }

  for (const candidate of ["main", "master"]) {
    if (candidate !== headBranch && branches.includes(candidate)) {
      return { baseBranch: candidate, headBranch };
    }
  }

  return {
    baseBranch: branches.find((branch) => branch !== headBranch) ?? branches[0],
    headBranch,
  };
}
