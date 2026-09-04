import * as vscode from "vscode";
import * as path from "path";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoManager, RepoInfo } from "../context/repoManager";
import { AuthManager } from "../auth/authManager";
import { debug, info } from "../debug/outputChannel";
import {
  PullRequestProvider,
  PullRequestItem,
} from "../views/pullRequestProvider";
import { PRDetailPanel } from "../views/prDetailPanel";
import {
  PRDiffProvider,
  PRDiffFileItem,
  PRDiffDirItem,
  PRDiffSectionItem,
} from "../views/prDiffProvider";
import type { GiteaPullRequest } from "../api/types";
import type { ReviewedFileStateService } from "../features/pullRequests/services/reviewedFileStateService";
import type { WorkingFileBridgeService } from "../features/pullRequests/services/workingFileBridgeService";
import {
  createPullRequestConversationApiView,
  type PullRequestConversationService,
} from "../features/pullRequests/services/pullRequestConversationService";
import {
  createPullRequestSnapshotDocumentIdentity,
  createPullRequestSnapshotUri,
} from "../features/pullRequests/services/pullRequestSnapshotDocumentProvider";

type PRDetailTarget =
  | PullRequestItem
  | { pr: GiteaPullRequest; repoInfo: RepoInfo };

export function registerPRCommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  repoManager: RepoManager,
  auth: AuthManager,
  prProvider: PullRequestProvider,
  reviewedFiles: ReviewedFileStateService,
  workingFileBridge: WorkingFileBridgeService,
  reviewConversations: PullRequestConversationService,
): void {
  context.subscriptions.push(
    PRDiffProvider.onDidChangeCheckboxState(({ provider, event }) => {
      void handlePRDiffCheckboxChange(provider, event, reviewedFiles);
    }),

    vscode.commands.registerCommand("gitea.refreshPRs", () =>
      prProvider.refresh(),
    ),

    vscode.commands.registerCommand("gitea.loadMorePRs", (repoKey: string) => {
      prProvider.loadMore(repoKey);
    }),

    vscode.commands.registerCommand(
      "gitea.openPR",
      async (arg: PullRequestItem | GiteaPullRequest) => {
        const pr = arg instanceof PullRequestItem ? arg.pr : arg;
        await vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
      },
    ),

    vscode.commands.registerCommand(
      "gitea.viewPRDetail",
      async (target: PRDetailTarget) => {
        const pr = target instanceof PullRequestItem ? target.pr : target.pr;
        const repoInfo =
          target instanceof PullRequestItem ? target.repoInfo : target.repoInfo;
        await PRDetailPanel.show(
          context.extensionUri,
          createPullRequestConversationApiView(
            api,
            reviewConversations,
            repoInfo,
            pr,
          ),
          repoInfo,
          pr,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.openPRDiff",
      async (item: PullRequestItem) => {
        await PRDiffProvider.show(api, item.repoInfo, item.pr);
        const provider = PRDiffProvider.getActive();
        if (provider) {
          const filenames = await reviewedFiles.reconcile(
            provider.repoInfo,
            provider.pr,
          );
          info(
            `[reviewed-files] open diff restore repo=${provider.repoInfo.key} pr=#${provider.pr.number} head=${provider.pr.head.sha.slice(0, 8)} restored=${filenames.length}`,
          );
          for (const filename of filenames) provider.markViewed(filename);
        }
      },
    ),

    vscode.commands.registerCommand(
      "gitea.openFileDiff",
      async (repoInfo: RepoInfo, pr: GiteaPullRequest, filename: string) => {
        await openFileDiff(repoInfo, pr, filename);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.prDiffFileAction",
      async (fileItem: PRDiffFileItem) => {
        const provider = PRDiffProvider.getActive();
        if (!provider || !fileItem) return;
        await openFileDiff(
          fileItem.repoInfo,
          fileItem.pr,
          fileItem.filename,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.openWorkingFile",
      async (fileItem: PRDiffFileItem) => {
        const provider = PRDiffProvider.getActive();
        if (!provider || !fileItem) return;

        const result = await workingFileBridge.open(
          provider.repoInfo,
          provider.pr,
          fileItem.filename,
        );
        if (result.kind === "opened") return;

        switch (result.reason) {
          case "sourceRepositoryNotInWorkspace":
            vscode.window.showInformationMessage(
              `Working file unavailable: PR source repository '${provider.pr.head.repo.full_name}' is not open in this workspace. The PR diff remains available.`,
            );
            return;
          case "sourceBranchNotCheckedOut":
            vscode.window.showInformationMessage(
              `Working file unavailable: source branch '${result.expectedBranch}' is not checked out${result.currentBranch ? ` (current: '${result.currentBranch}')` : ""}. This action does not switch branches automatically.`,
            );
            return;
          case "fileNotFound":
            vscode.window.showInformationMessage(
              `Working file unavailable: '${fileItem.filename}' does not exist in the checked-out source workspace.`,
            );
            return;
          case "pathOutsideWorkspace":
            vscode.window.showWarningMessage(
              `Refusing to open '${fileItem.filename}' because it resolves outside the source workspace.`,
            );
        }
      },
    ),

    vscode.commands.registerCommand("gitea.prDiffDirAction", () => undefined),
    vscode.commands.registerCommand("gitea.prDiffSectionAction", () => undefined),

    vscode.commands.registerCommand(
      "gitea.addComment",
      async (arg?: PullRequestItem) => {
        if (arg instanceof PullRequestItem) {
          await addComment(api, arg.repoInfo, arg.pr.number, prProvider);
        } else {
          const repoInfo = await pickRepo(repoManager, auth);
          if (!repoInfo) return;
          const numStr = await vscode.window.showInputBox({
            prompt: "PR number",
            validateInput: (v) => (/^\d+$/.test(v) ? null : "Enter a number"),
          });
          if (!numStr) return;
          await addComment(api, repoInfo, parseInt(numStr, 10), prProvider);
        }
      },
    ),
  );
}

async function handlePRDiffCheckboxChange(
  provider: PRDiffProvider,
  event: vscode.TreeCheckboxChangeEvent<vscode.TreeItem>,
  reviewedFiles: ReviewedFileStateService,
): Promise<void> {
  debug(
    `[reviewed-files] TreeView checkbox event items=${event.items.length} repo=${provider.repoInfo.key} pr=#${provider.pr.number}`,
  );

  for (const [item, state] of event.items) {
    const reviewed = state === vscode.TreeItemCheckboxState.Checked;

    if (item instanceof PRDiffFileItem) {
      info(
        `[reviewed-files] checkbox file=${item.filename} reviewed=${reviewed} repo=${provider.repoInfo.key} pr=#${provider.pr.number} head=${provider.pr.head.sha.slice(0, 8)}`,
      );
      if (reviewed) provider.markViewed(item.filename);
      else provider.markUnviewed(item.filename);
      await reviewedFiles.setReviewed(
        provider.repoInfo,
        provider.pr,
        [item.filename],
        reviewed,
      );
      continue;
    }

    if (item instanceof PRDiffDirItem) {
      provider.toggleDirViewed(item.dirPath, reviewed);
      const filenames = await reviewedFiles.filenamesUnder(
        provider.repoInfo,
        provider.pr,
        item.dirPath,
      );
      info(
        `[reviewed-files] checkbox dir=${item.dirPath} reviewed=${reviewed} files=${filenames.length} repo=${provider.repoInfo.key} pr=#${provider.pr.number}`,
      );
      await reviewedFiles.setReviewed(
        provider.repoInfo,
        provider.pr,
        filenames,
        reviewed,
      );
      continue;
    }

    if (item instanceof PRDiffSectionItem && item.id === "files") {
      provider.toggleAllViewed(reviewed);
      const filenames = await reviewedFiles.allFilenames(
        provider.repoInfo,
        provider.pr,
      );
      info(
        `[reviewed-files] checkbox section=files reviewed=${reviewed} files=${filenames.length} repo=${provider.repoInfo.key} pr=#${provider.pr.number}`,
      );
      await reviewedFiles.setReviewed(
        provider.repoInfo,
        provider.pr,
        filenames,
        reviewed,
      );
    }
  }
}

async function pickRepo(
  repoManager: RepoManager,
  auth: AuthManager,
): Promise<RepoInfo | undefined> {
  const repos = repoManager.getRepos();
  if (repos.length === 0) {
    vscode.window.showErrorMessage("No Gitea repositories detected.");
    return undefined;
  }
  if (repos.length === 1) return repos[0];
  const choice = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: r.label,
      description: r.serverUrl,
      repoInfo: r,
    })),
    { placeHolder: "Select a repository" },
  );
  return choice?.repoInfo;
}

async function addComment(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  prNumber: number,
  prProvider: PullRequestProvider,
): Promise<void> {
  const body = await vscode.window.showInputBox({
    prompt: `Comment on PR #${prNumber}`,
    validateInput: (v) => (v?.trim() ? null : "Comment cannot be empty"),
  });
  if (!body) return;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Posting comment...",
      },
      async () => {
        await api.addPRComment(repoInfo, prNumber, body);
      },
    );
    vscode.window.showInformationMessage("Comment posted.");
    prProvider.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to post comment: ${(err as Error).message}`,
    );
  }
}

async function openFileDiff(
  repoInfo: RepoInfo,
  pr: GiteaPullRequest,
  filename: string,
): Promise<void> {
  try {
    const baseUri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(repoInfo, pr, "base", filename),
    );
    const headUri = createPullRequestSnapshotUri(
      createPullRequestSnapshotDocumentIdentity(repoInfo, pr, "head", filename),
    );

    const [baseDocument, headDocument] = await Promise.all([
      vscode.workspace.openTextDocument(baseUri),
      vscode.workspace.openTextDocument(headUri),
    ]);

    const hasNullByte = (text: string) => text.includes("\0");
    if (
      hasNullByte(baseDocument.getText()) ||
      hasNullByte(headDocument.getText())
    ) {
      vscode.window.showInformationMessage(
        `File '${filename}' appears to be binary — skipping diff.`,
      );
      return;
    }

    const title =
      filename === path.basename(filename)
        ? `${filename} (${pr.head.ref} → ${pr.base.ref})`
        : `PR #${pr.number} — ${filename}`;

    await vscode.commands.executeCommand(
      "vscode.diff",
      baseUri,
      headUri,
      title,
      { preview: true, preserveFocus: false },
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to open diff for '${filename}': ${(err as Error).message}`,
    );
  }
}
