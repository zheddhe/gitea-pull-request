import type {
  GiteaActionArtifact,
  GiteaJobStep,
} from "../../../api/types";

export type CIExecutionDetailAvailability =
  | "available"
  | "unavailable";

export interface CIArtifactDetail {
  id: number;
  name: string;
  sizeInBytes?: number;
  expired: boolean;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  downloadUrl?: string;
}

export interface CIArtifactDetailResult {
  availability: CIExecutionDetailAvailability;
  artifacts: CIArtifactDetail[];
  rejectedCount: number;
}

export interface CIStepDetail {
  number: number;
  name: string;
  status?: string;
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CIStepDetailResult {
  availability: CIExecutionDetailAvailability;
  steps: CIStepDetail[];
  rejectedCount: number;
}

/**
 * Normalize artifact metadata without inventing identifiers or names.
 * Invalid entries are rejected rather than projected as synthetic artifacts.
 */
export function normalizeArtifactDetail(
  source: Partial<GiteaActionArtifact>,
): CIArtifactDetail | undefined {
  const id = positiveInteger(source.id);
  const name = nonEmpty(source.name);
  if (id === undefined || name === undefined) return undefined;

  return {
    id,
    name,
    sizeInBytes: nonNegativeInteger(source.size_in_bytes),
    expired: source.expired === true,
    expiresAt: validTimestamp(source.expires_at),
    createdAt: validTimestamp(source.created_at),
    updatedAt: validTimestamp(source.updated_at),
    downloadUrl: nonEmpty(source.archive_download_url),
  };
}

export function normalizeArtifactDetails(
  sources: readonly Partial<GiteaActionArtifact>[] | undefined | null,
): CIArtifactDetailResult {
  if (!Array.isArray(sources)) {
    return { availability: "unavailable", artifacts: [], rejectedCount: 0 };
  }

  const artifacts: CIArtifactDetail[] = [];
  let rejectedCount = 0;
  for (const source of sources) {
    const artifact = normalizeArtifactDetail(source);
    if (artifact) artifacts.push(artifact);
    else rejectedCount += 1;
  }

  return { availability: "available", artifacts, rejectedCount };
}

/**
 * Project structured workflow steps only when Gitea supplied the minimum
 * authoritative identity for a step (positive number + non-empty name).
 * Missing timing/status fields remain absent; they are never inferred from logs.
 */
export function normalizeStepDetail(
  source: Partial<GiteaJobStep>,
): CIStepDetail | undefined {
  const number = positiveInteger(source.number);
  const name = nonEmpty(source.name);
  if (number === undefined || name === undefined) return undefined;

  return {
    number,
    name,
    status: nonEmpty(source.status),
    conclusion: nonEmpty(source.conclusion),
    startedAt: validTimestamp(source.started_at),
    completedAt: validTimestamp(source.completed_at),
  };
}

export function normalizeStepDetails(
  sources: readonly Partial<GiteaJobStep>[] | undefined | null,
): CIStepDetailResult {
  if (!Array.isArray(sources)) {
    return { availability: "unavailable", steps: [], rejectedCount: 0 };
  }

  const steps: CIStepDetail[] = [];
  let rejectedCount = 0;
  for (const source of sources) {
    const step = normalizeStepDetail(source);
    if (step) steps.push(step);
    else rejectedCount += 1;
  }

  steps.sort((left, right) => left.number - right.number);
  return { availability: "available", steps, rejectedCount };
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : undefined;
}

function validTimestamp(value: string | undefined | null): string | undefined {
  const candidate = nonEmpty(value);
  if (!candidate) return undefined;
  return Number.isNaN(Date.parse(candidate)) ? undefined : candidate;
}
