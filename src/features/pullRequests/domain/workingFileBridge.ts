export interface WorkingRepositoryCandidate {
  key: string;
  serverUrl: string;
  label: string;
  rootPath: string;
  currentBranch?: string;
}

export type WorkingFileBridgeDecision =
  | {
      kind: "available";
      repository: WorkingRepositoryCandidate;
    }
  | {
      kind: "unavailable";
      reason:
        | "sourceRepositoryNotInWorkspace"
        | "sourceBranchNotCheckedOut";
      repository?: WorkingRepositoryCandidate;
    };

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/$/, "").toLowerCase();
}

export function evaluateWorkingFileBridge(
  activeServerUrl: string,
  sourceRepositoryFullName: string,
  sourceBranch: string,
  candidates: WorkingRepositoryCandidate[],
): WorkingFileBridgeDecision {
  const server = normalizeServerUrl(activeServerUrl);
  const sourceRepository = candidates.find(
    (candidate) =>
      normalizeServerUrl(candidate.serverUrl) === server &&
      candidate.label === sourceRepositoryFullName,
  );

  if (!sourceRepository) {
    return { kind: "unavailable", reason: "sourceRepositoryNotInWorkspace" };
  }

  if (sourceRepository.currentBranch !== sourceBranch) {
    return {
      kind: "unavailable",
      reason: "sourceBranchNotCheckedOut",
      repository: sourceRepository,
    };
  }

  return { kind: "available", repository: sourceRepository };
}
