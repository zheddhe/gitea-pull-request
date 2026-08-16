import { GiteaPullRequest } from "../../../api/types";

export interface RepositoryRef {
  key: string;
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
      repository: RepositoryRef;
      pullRequest: GiteaPullRequest;
      checkoutState: CheckoutState;
    }
  | {
      kind: "merged";
      repository: RepositoryRef;
      pullRequest: GiteaPullRequest;
      localBranchExists: boolean;
      remoteBranchExists: boolean;
    };

export const idlePullRequestState: PullRequestWorkspaceState = {
  kind: "idle",
};
