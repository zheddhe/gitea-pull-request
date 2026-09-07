import type {
  GiteaComment,
  GiteaPullRequest,
  GiteaReview,
  GiteaReviewComment,
} from "../../../api/types";

export interface PullRequestDetailRemoteSnapshot {
  pullRequest: GiteaPullRequest;
  comments: readonly GiteaComment[];
  reviews: readonly GiteaReview[];
  reviewComments: readonly GiteaReviewComment[];
}

export function pullRequestDetailFingerprint(
  snapshot: PullRequestDetailRemoteSnapshot,
): string {
  const pr = snapshot.pullRequest;
  const metadata = [
    pr.number,
    pr.state,
    pr.merged,
    pr.title,
    pr.body,
    pr.base.sha,
    pr.head.sha,
    pr.mergeable,
    ...(pr.labels ?? []).map((label) => `${label.id}:${label.name}:${label.color}`).sort(),
    ...(pr.assignees ?? []).map((user) => user.login).sort(),
    pr.assignee?.login ?? "",
    pr.milestone?.id ?? "",
  ].join("|");
  const comments = snapshot.comments
    .map((comment) =>
      [comment.id, comment.updated_at, comment.user.login, comment.body].join(":"),
    )
    .sort()
    .join("|");
  const reviews = snapshot.reviews
    .map((review) =>
      [
        review.id,
        review.user.login,
        review.state,
        review.submitted_at,
        review.stale,
        review.body,
      ].join(":"),
    )
    .sort()
    .join("|");
  const reviewComments = snapshot.reviewComments
    .map((comment) =>
      [
        comment.id,
        comment.updated_at,
        comment.user.login,
        comment.resolver?.login ?? "",
        comment.body,
        comment.path,
        comment.position ?? "",
        comment.original_position ?? "",
      ].join(":"),
    )
    .sort()
    .join("|");
  return `${metadata}::${comments}::${reviews}::${reviewComments}`;
}
