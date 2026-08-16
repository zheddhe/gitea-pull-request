import { GiteaPullRequest } from "../../../api/types";

export interface RepositoryRef {
  owner: string;
  name: string;
  fullName: string;
}

export type CheckoutState =
  | { kind: "notCheckedOut" }
  | { kind: "checkedOut"; localBranch: string };

export type PullRequestWorkspaceState =
  | { kind: "idle" }
  | {
      kind: "creating";
      repository: RepositoryRef;
      baseBranch: string;
      headBranch: string;
    }
  | {
      kind: "active";
      pullRequest: GiteaPullRequest;
      checkoutState: CheckoutState;
    }
  | {
      kind: "merged";
      pullRequest: GiteaPullRequest;
      localBranchExists: boolean;
      remoteBranchExists: boolean;
    };

export const idlePullRequestState: PullRequestWorkspaceState = {
  kind: "idle",
};
