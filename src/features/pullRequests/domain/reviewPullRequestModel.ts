import type {
  GiteaCombinedStatus,
  GiteaPullRequest,
  GiteaReview,
} from "../../../api/types";

export type MergeMethod = "merge" | "squash" | "rebase";

export interface RepositoryMergeSettings {
  allow_merge_commits?: boolean;
  allow_squash_merge?: boolean;
  allow_rebase?: boolean;
  default_merge_style?: string;
}

export interface BranchMergePolicy {
  protected?: boolean;
  enable_status_check?: boolean;
  required_approvals?: number;
  status_check_contexts?: string[];
  user_can_merge?: boolean;
}

export interface MergeReadiness {
  canMerge: boolean;
  blockingReasons: string[];
  warnings: string[];
  ciLabel: string;
  reviewLabel: string;
}

export function isWorkInProgress(pr: GiteaPullRequest): boolean {
  return /^(?:WIP:|\[WIP\])/i.test((pr.title ?? "").trim());
}

export function supportedMergeMethods(
  settings: RepositoryMergeSettings | undefined,
): MergeMethod[] {
  if (!settings) {
    return ["merge", "squash", "rebase"];
  }

  const methods: MergeMethod[] = [];
  if (settings.allow_merge_commits !== false) methods.push("merge");
  if (settings.allow_squash_merge !== false) methods.push("squash");
  if (settings.allow_rebase !== false) methods.push("rebase");
  return methods;
}

export function preferredMergeMethod(
  supported: MergeMethod[],
  persisted: MergeMethod | undefined,
  repositoryDefault: string | undefined,
): MergeMethod | undefined {
  if (persisted && supported.includes(persisted)) return persisted;

  const normalized =
    repositoryDefault === "squash"
      ? "squash"
      : repositoryDefault === "rebase" || repositoryDefault === "rebase-merge"
        ? "rebase"
        : repositoryDefault === "merge"
          ? "merge"
          : undefined;
  if (normalized && supported.includes(normalized)) return normalized;
  return supported[0];
}

export function evaluateMergeReadiness(
  pr: GiteaPullRequest,
  status: GiteaCombinedStatus | undefined,
  reviews: GiteaReview[] | undefined,
  policy: BranchMergePolicy | undefined,
): MergeReadiness {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  if (pr.merged) blockingReasons.push("Pull request is already merged");
  else if (pr.state !== "open") blockingReasons.push("Pull request is closed");

  if (isWorkInProgress(pr)) {
    blockingReasons.push("Pull request is marked Work In Progress");
  }

  if (pr.mergeable === false) {
    blockingReasons.push("Gitea reports the pull request as not mergeable");
  } else if (pr.mergeable === undefined) {
    warnings.push("Mergeability is not reported by Gitea");
  }

  if (policy?.user_can_merge === false) {
    blockingReasons.push("Current user is not allowed to merge the target branch");
  }

  let ciLabel = "Checks unavailable";
  if (status) {
    const state = typeof status.state === "string" ? status.state : "unknown";
    ciLabel = `Checks: ${state}`;
    if (state === "failure" || state === "error") {
      blockingReasons.push(`Checks are ${state}`);
    } else if (state === "pending") {
      blockingReasons.push("Checks are still pending");
    } else if (state === "warning") {
      warnings.push("Checks completed with warnings");
    }
  } else if (policy?.enable_status_check) {
    warnings.push("Target branch requires status checks, but combined status could not be read");
  }

  const reviewList = Array.isArray(reviews) ? reviews : [];
  const effectiveReviews = latestReviewsByUser(reviewList);
  const approvals = effectiveReviews.filter((review) => review.state === "APPROVED").length;
  const changesRequested = effectiveReviews.filter(
    (review) => review.state === "REQUEST_CHANGES" || review.state === "REJECTED",
  ).length;
  const requiredApprovals =
    typeof policy?.required_approvals === "number" && policy.required_approvals > 0
      ? policy.required_approvals
      : 0;

  let reviewLabel = `${approvals} approval${approvals === 1 ? "" : "s"}`;
  if (requiredApprovals > 0) {
    reviewLabel += ` / ${requiredApprovals} required`;
  }
  if (changesRequested > 0) {
    reviewLabel += ` · ${changesRequested} requesting changes`;
    blockingReasons.push("At least one current review requests changes");
  }
  if (requiredApprovals > approvals) {
    blockingReasons.push(
      `${requiredApprovals - approvals} required approval${requiredApprovals - approvals === 1 ? " is" : "s are"} missing`,
    );
  }

  return {
    canMerge: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    ciLabel,
    reviewLabel,
  };
}

function latestReviewsByUser(reviews: GiteaReview[]): GiteaReview[] {
  const byUser = new Map<string, GiteaReview>();
  let anonymousIndex = 0;

  for (const review of reviews) {
    if (!review || review.stale) continue;

    const login = review.user?.login?.trim();
    const key = login || `anonymous-review-${review.id ?? anonymousIndex++}`;
    const existing = byUser.get(key);
    if (!existing || submittedAt(review) >= submittedAt(existing)) {
      byUser.set(key, review);
    }
  }
  return [...byUser.values()];
}

function submittedAt(review: GiteaReview): number {
  const parsed = Date.parse(review.submitted_at ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}
