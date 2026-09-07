export type CISemanticState =
  | "success"
  | "running"
  | "queued"
  | "warning"
  | "failure"
  | "cancelled"
  | "skipped"
  | "unknown";

export interface CIPresentationActions {
  openInBrowser: boolean;
  rerun: boolean;
  cancel: boolean;
  openLogs: boolean;
}

export interface CIPresentationNode {
  kind: "run" | "job" | "step" | "external-check";
  state: CISemanticState;
  statusLabel: string;
  actions: CIPresentationActions;
}

export function normalizeCIState(
  status: string | undefined | null,
  conclusion?: string | undefined | null,
): CISemanticState {
  const rawStatus = clean(status);
  const rawConclusion = clean(conclusion);
  const effective = rawStatus === "completed" && rawConclusion ? rawConclusion : rawStatus;

  switch (effective) {
    case "success":
    case "passed":
    case "completed":
      return "success";
    case "running":
    case "in_progress":
      return "running";
    case "queued":
    case "waiting":
    case "pending":
    case "blocked":
      return "queued";
    case "warning":
      return "warning";
    case "failure":
    case "failed":
    case "error":
      return "failure";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return "unknown";
  }
}

export function ciStatusLabel(
  status: string | undefined | null,
  conclusion?: string | undefined | null,
): string {
  const rawStatus = clean(status) || "unknown";
  const rawConclusion = clean(conclusion);
  const effective = rawStatus === "completed" && rawConclusion ? rawConclusion : rawStatus;
  return effective.replace(/_/g, " ");
}

export function isCITerminalState(state: CISemanticState): boolean {
  return (
    state === "success" ||
    state === "warning" ||
    state === "failure" ||
    state === "cancelled" ||
    state === "skipped"
  );
}

export function runPresentation(
  status: string | undefined | null,
  conclusion: string | undefined | null,
  targetUrl?: string | undefined,
): CIPresentationNode {
  const state = normalizeCIState(status, conclusion);
  const active = state === "running" || state === "queued";
  return {
    kind: "run",
    state,
    statusLabel: ciStatusLabel(status, conclusion),
    actions: {
      openInBrowser: !!clean(targetUrl),
      rerun: isCITerminalState(state),
      cancel: active,
      openLogs: false,
    },
  };
}

export function jobPresentation(
  status: string | undefined | null,
  conclusion: string | undefined | null,
  targetUrl?: string | undefined,
): CIPresentationNode {
  const state = normalizeCIState(status, conclusion);
  return {
    kind: "job",
    state,
    statusLabel: ciStatusLabel(status, conclusion),
    actions: {
      openInBrowser: !!clean(targetUrl),
      rerun: isCITerminalState(state),
      cancel: false,
      openLogs: true,
    },
  };
}

export function externalCheckPresentation(
  status: string | undefined | null,
  targetUrl?: string | undefined,
): CIPresentationNode {
  const state = normalizeCIState(status);
  const runId = extractGiteaRunId(targetUrl);
  const active = state === "running" || state === "queued";
  return {
    kind: "external-check",
    state,
    statusLabel: ciStatusLabel(status),
    actions: {
      openInBrowser: !!clean(targetUrl),
      rerun: runId !== undefined && isCITerminalState(state),
      cancel: runId !== undefined && active,
      openLogs: false,
    },
  };
}

export function extractGiteaRunId(targetUrl: string | undefined | null): number | undefined {
  const value = clean(targetUrl);
  if (!value) return undefined;
  const match = value.match(/\/actions\/runs\/(\d+)(?:[/?#]|$)/i);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function isCIActiveState(status: string | undefined | null): boolean {
  const state = normalizeCIState(status);
  return state === "running" || state === "queued";
}

function clean(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}
