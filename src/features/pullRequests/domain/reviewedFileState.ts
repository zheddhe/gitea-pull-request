import { createHash } from "crypto";

export interface ReviewedFileRecord {
  repositoryKey: string;
  pullRequestNumber: number;
  filename: string;
  reviewedAtHead: string;
  fingerprint?: string;
}

export interface CurrentReviewedFileIdentity {
  filename: string;
  fingerprint?: string;
}

export function fingerprintPatch(patch: string | undefined): string | undefined {
  if (!patch?.trim()) return undefined;
  return createHash("sha256").update(patch).digest("hex");
}

export function reconcileReviewedFiles(
  records: ReviewedFileRecord[],
  repositoryKey: string,
  pullRequestNumber: number,
  currentHead: string,
  currentFiles: CurrentReviewedFileIdentity[],
): ReviewedFileRecord[] {
  const currentByFilename = new Map(
    currentFiles.map((file) => [file.filename, file] as const),
  );

  return records.flatMap((record) => {
    if (
      record.repositoryKey !== repositoryKey ||
      record.pullRequestNumber !== pullRequestNumber
    ) {
      return [];
    }

    const current = currentByFilename.get(record.filename);
    if (!current) return [];

    if (record.reviewedAtHead === currentHead) {
      return [record];
    }

    if (
      !record.fingerprint ||
      !current.fingerprint ||
      record.fingerprint !== current.fingerprint
    ) {
      return [];
    }

    return [
      {
        ...record,
        reviewedAtHead: currentHead,
        fingerprint: current.fingerprint,
      },
    ];
  });
}
