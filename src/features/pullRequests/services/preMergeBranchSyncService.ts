import type { RepoInfo } from "../../../context/repoManager";
import type { BranchIdentity } from "./branchCleanupService";
import type { BranchSyncDiagnostic } from "./branchSyncAnalyzerService";
import { preMergeBranchSyncWarning } from "./branchSyncAnalyzerService";

export interface PreMergeBranchIdentityDiscovery {
  discover(repoInfo: RepoInfo, prHead: string, base: string): Promise<BranchIdentity>;
}

export interface PreMergeBranchSyncAnalysis {
  analyze(
    repoInfo: RepoInfo,
    identity: BranchIdentity,
    prHeadSha: string,
  ): Promise<BranchSyncDiagnostic>;
}

export interface PreMergeBranchSyncResult {
  diagnostic: BranchSyncDiagnostic;
  warning?: string;
}

export class PreMergeBranchSyncService {
  constructor(
    private readonly branchIdentity: PreMergeBranchIdentityDiscovery,
    private readonly branchSync: PreMergeBranchSyncAnalysis,
  ) {}

  async evaluate(
    repoInfo: RepoInfo,
    pullRequest: {
      head: { ref: string; sha: string };
      base: { ref: string };
    },
  ): Promise<PreMergeBranchSyncResult> {
    const identity = await this.branchIdentity.discover(
      repoInfo,
      pullRequest.head.ref,
      pullRequest.base.ref,
    );
    const diagnostic = await this.branchSync.analyze(
      repoInfo,
      identity,
      pullRequest.head.sha,
    );
    return {
      diagnostic,
      warning: preMergeBranchSyncWarning(diagnostic),
    };
  }
}
