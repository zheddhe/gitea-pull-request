/** Gitea REST API types */

export interface GiteaUser {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
}

export interface GiteaRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GiteaUser;
  html_url: string;
  default_branch: string;
  private: boolean;
  fork: boolean;
}

export interface GiteaLabel {
  id: number;
  name: string;
  color: string;
}

export interface GiteaMilestone {
  id: number;
  title: string;
  state: "open" | "closed";
}

export interface GiteaBranch {
  name: string;
  commit: { id: string; message: string };
}

export interface GiteaPullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  html_url: string;
  user: GiteaUser;
  assignee?: GiteaUser;
  assignees?: GiteaUser[];
  labels?: GiteaLabel[];
  milestone?: GiteaMilestone;
  head: { label: string; ref: string; sha: string; repo: GiteaRepository };
  base: { label: string; ref: string; sha: string; repo: GiteaRepository };
  merged: boolean;
  mergeable?: boolean;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  merged_at?: string;
  comments: number;
  review_comments: number;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface GiteaComment {
  id: number;
  body: string;
  user: GiteaUser;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GiteaReview {
  id: number;
  user: GiteaUser;
  body: string;
  state:
    | "APPROVED"
    | "REQUEST_CHANGES"
    | "COMMENT"
    | "REQUEST_REVIEW"
    | "REJECTED"
    | "pending";
  submitted_at: string;
  stale: boolean;
  html_url: string;
}

export interface GiteaReviewComment {
  id: number;
  user: GiteaUser;
  resolver?: GiteaUser;
  body: string;
  path: string;
  pull_request_review_id?: number;
  commit_id?: string;
  original_commit_id?: string;
  diff_hunk?: string;
  /** Current/new-file line returned by Gitea when reading a review comment. */
  position?: number;
  /** Original/old-file line returned by Gitea when reading a review comment. */
  original_position?: number;
  /** @deprecated Internal compatibility alias while the detail renderer migrates. */
  new_position?: number;
  /** @deprecated Internal compatibility alias while the detail renderer migrates. */
  old_position?: number;
  created_at: string;
  updated_at: string;
  html_url?: string;
  pull_request_url?: string;
}

export interface GiteaFileDiff {
  filename: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  changes: number;
  html_url: string;
  patch?: string;
}

export interface GiteaCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  author?: GiteaUser;
  html_url: string;
}

export interface GiteaCombinedStatus {
  state: "pending" | "success" | "error" | "failure" | "warning";
  statuses: GiteaCommitStatus[];
  total_count: number;
}

export interface GiteaCommitStatus {
  id: number;
  state: "pending" | "success" | "error" | "failure" | "warning";
  context: string;
  description: string;
  target_url: string;
  created_at: string;
}

// Gitea Actions / CI types

export interface GiteaWorkflowRun {
  id: number;
  name: string;
  display_title: string;
  status:
    | "unknown"
    | "waiting"
    | "running"
    | "in_progress"
    | "completed"
    | "success"
    | "failure"
    | "cancelled"
    | "skipped"
    | "blocked"
    | "pending";
  conclusion: string;
  workflow_id: string;
  run_number: number;
  event: string;
  run_started_at: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  head_branch: string;
  head_sha: string;
  head_commit: { message: string; author: { name: string } };
  repository: GiteaRepository;
  triggering_actor?: GiteaUser;
  jobs_url: string;
}

export interface GiteaWorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string;
  started_at: string;
  completed_at: string;
  html_url: string;
  steps?: GiteaJobStep[];
  runner_name: string;
}

export interface GiteaJobStep {
  name: string;
  status: string;
  conclusion: string;
  number: number;
  started_at: string;
  completed_at: string;
}

export interface GiteaWorkflow {
  id: string;
  name: string;
  path: string;
  state: string;
}

/** Paginated list response helper */
export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
  page: number;
}

export interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  html_url: string;
  user: GiteaUser;
  assignee?: GiteaUser;
  assignees?: GiteaUser[];
  labels?: GiteaLabel[];
  milestone?: GiteaMilestone;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  pull_request?: {
    merged: boolean;
    diff_url: string;
    html_url: string;
    patch_url: string;
  };
}
