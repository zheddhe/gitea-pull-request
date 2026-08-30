import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
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
): void {
  context.subscriptions.push(
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
          api,
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
        await openFileDiff(api, repoInfo, pr, filename);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.prDiffFileAction",
      async (...args: unknown[]) => {
        const provider = PRDiffProvider.getActive();
        if (!provider) return;

        debug(
          `[reviewed-files] file action args=${args.length} firstType=${typeof args[0]} secondType=${typeof args[1]}`,
        );
        const fileItem = (args.length > 1 ? args[1] : args[0]) as PRDiffFileItem;

        if (args.length > 1 && typeof args[0] === "number") {
          const state = args[0] as vscode.TreeItemCheckboxState;
          const viewed = state === vscode.TreeItemCheckboxState.Checked;
          info(
            `[reviewed-files] checkbox file=${fileItem.filename} reviewed=${viewed} repo=${provider.repoInfo.key} pr=#${provider.pr.number} head=${provider.pr.head.sha.slice(0, 8)}`,
          );
          if (viewed) provider.markViewed(fileItem.filename);
          else provider.markUnviewed(fileItem.filename);
          await reviewedFiles.setReviewed(
            provider.repoInfo,
            provider.pr,
            [fileItem.filename],
            viewed,
          );
        } else {
          await openFileDiff(
            provider.api,
            fileItem.repoInfo,
            fileItem.pr,
            fileItem.filename,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "gitea.prDiffDirAction",
      async (...args: unknown[]) => {
        const provider = PRDiffProvider.getActive();
        if (!provider) return;

        debug(
          `[reviewed-files] dir action args=${args.length} firstType=${typeof args[0]} secondType=${typeof args[1]}`,
        );
        const dirItem = (args.length > 1 ? args[1] : args[0]) as PRDiffDirItem;

        if (args.length > 1 && typeof args[0] === "number") {
          const state = args[0] as vscode.TreeItemCheckboxState;
          const check = state === vscode.TreeItemCheckboxState.Checked;
          provider.toggleDirViewed(dirItem.dirPath, check);
          const filenames = await reviewedFiles.filenamesUnder(
            provider.repoInfo,
            provider.pr,
            dirItem.dirPath,
          );
          info(
            `[reviewed-files] checkbox dir=${dirItem.dirPath} reviewed=${check} files=${filenames.length} repo=${provider.repoInfo.key} pr=#${provider.pr.number}`,
          );
          await reviewedFiles.setReviewed(
            provider.repoInfo,
            provider.pr,
            filenames,
            check,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "gitea.prDiffSectionAction",
      async (...args: unknown[]) => {
        const provider = PRDiffProvider.getActive();
        if (!provider) return;

        debug(
          `[reviewed-files] section action args=${args.length} firstType=${typeof args[0]} secondType=${typeof args[1]}`,
        );
        const sectionItem = (args.length > 1 ? args[1] : args[0]) as PRDiffSectionItem;

        if (args.length > 1 && typeof args[0] === "number") {
          const state = args[0] as vscode.TreeItemCheckboxState;
          if (sectionItem.id === "files") {
            const check = state === vscode.TreeItemCheckboxState.Checked;
            provider.toggleAllViewed(check);
            const filenames = await reviewedFiles.allFilenames(
              provider.repoInfo,
              provider.pr,
            );
            info(
              `[reviewed-files] checkbox section=files reviewed=${check} files=${filenames.length} repo=${provider.repoInfo.key} pr=#${provider.pr.number}`,
            );
            await reviewedFiles.setReviewed(
              provider.repoInfo,
              provider.pr,
              filenames,
              check,
            );
          }
        }
      },
    ),

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
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  pr: GiteaPullRequest,
  filename: string,
): Promise<void> {
  const tmpDir = path.join(
    os.tmpdir(),
    `gitea-diff-${repoInfo.key.replace(/[^a-zA-Z0-9]/g, "_")}-${pr.number}-${Date.now()}`,
  );

  try {
    const [baseContent, headContent] = await Promise.allSettled([
      api.getFileContents(repoInfo, pr.base.ref, filename),
      api.getFileContents(repoInfo, pr.head.ref, filename),
    ]);

    const baseText = baseContent.status === "fulfilled" ? baseContent.value : "";
    const headText = headContent.status === "fulfilled" ? headContent.value : "";

    const hasNullByte = (s: string) => s.includes("\0");
    if (hasNullByte(baseText) || hasNullByte(headText)) {
      vscode.window.showInformationMessage(
        `File '${filename}' appears to be binary — skipping diff.`,
      );
      return;
    }

    const baseFile = path.join(tmpDir, ".base", filename);
    const headFile = path.join(tmpDir, ".head", filename);

    fs.mkdirSync(path.dirname(baseFile), { recursive: true });
    fs.mkdirSync(path.dirname(headFile), { recursive: true });
    fs.writeFileSync(baseFile, baseText);
    fs.writeFileSync(headFile, headText);

    const baseUri = vscode.Uri.file(baseFile);
    const headUri = vscode.Uri.file(headFile);

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
