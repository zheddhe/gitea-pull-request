import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoManager, RepoInfo } from "../context/repoManager";
import { AuthManager } from "../auth/authManager";
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
import type { GiteaFileDiff, GiteaPullRequest } from "../api/types";
import {
  fingerprintPatch,
  reconcileReviewedFiles,
  type CurrentReviewedFileIdentity,
  type ReviewedFileRecord,
} from "../features/pullRequests/domain/reviewedFileState";

const REVIEWED_FILES_STATE_KEY = "gitea.prDiff.reviewedFiles.v1";
const reviewedFileIdentityCache = new Map<string, CurrentReviewedFileIdentity[]>();
let reviewedStateWrite: Promise<void> = Promise.resolve();

type PRDetailTarget =
  | PullRequestItem
  | { pr: GiteaPullRequest; repoInfo: RepoInfo };

export function registerPRCommands(
  context: vscode.ExtensionContext,
  api: GiteaApiClient,
  repoManager: RepoManager,
  auth: AuthManager,
  prProvider: PullRequestProvider,
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
          await restoreReviewedFiles(context.workspaceState, api, provider);
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

        const fileItem = (args.length > 1 ? args[1] : args[0]) as PRDiffFileItem;

        if (args.length > 1 && typeof args[0] === "number") {
          const state = args[0] as vscode.TreeItemCheckboxState;
          const viewed = state === vscode.TreeItemCheckboxState.Checked;
          if (viewed) provider.markViewed(fileItem.filename);
          else provider.markUnviewed(fileItem.filename);
          await persistReviewedFiles(
            context.workspaceState,
            api,
            provider,
            [fileItem.filename],
            viewed,
          );
        } else {
          await openFileDiff(provider.api, fileItem.repoInfo, fileItem.pr, fileItem.filename);
        }
      },
    ),

    vscode.commands.registerCommand(
      "gitea.prDiffDirAction",
      async (...args: unknown[]) => {
        const provider = PRDiffProvider.getActive();
        if (!provider) return;

        const dirItem = (args.length > 1 ? args[1] : args[0]) as PRDiffDirItem;

        if (args.length > 1 && typeof args[0] === "number") {
          const state = args[0] as vscode.TreeItemCheckboxState;
          const check = state === vscode.TreeItemCheckboxState.Checked;
          provider.toggleDirViewed(dirItem.dirPath, check);
          const identities = await currentReviewedFileIdentities(api, provider.repoInfo, provider.pr);
          const prefix = `${dirItem.dirPath}/`;
          await persistReviewedFiles(
            context.workspaceState,
            api,
            provider,
            identities
              .map((identity) => identity.filename)
              .filter((filename) => filename.startsWith(prefix)),
            check,
            identities,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "gitea.prDiffSectionAction",
      async (...args: unknown[]) => {
        const provider = PRDiffProvider.getActive();
        if (!provider) return;

        const sectionItem = (args.length > 1 ? args[1] : args[0]) as PRDiffSectionItem;

        if (args.length > 1 && typeof args[0] === "number") {
          const state = args[0] as vscode.TreeItemCheckboxState;
          if (sectionItem.id === "files") {
            const check = state === vscode.TreeItemCheckboxState.Checked;
            provider.toggleAllViewed(check);
            const identities = await currentReviewedFileIdentities(
              api,
              provider.repoInfo,
              provider.pr,
            );
            await persistReviewedFiles(
              context.workspaceState,
              api,
              provider,
              identities.map((identity) => identity.filename),
              check,
              identities,
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

async function restoreReviewedFiles(
  workspaceState: vscode.Memento,
  api: GiteaApiClient,
  provider: PRDiffProvider,
): Promise<void> {
  const identities = await currentReviewedFileIdentities(
    api,
    provider.repoInfo,
    provider.pr,
  );
  const allRecords = storedReviewedFiles(workspaceState);
  const scopedRecords = allRecords.filter((record) =>
    isReviewedFileScope(record, provider.repoInfo, provider.pr),
  );
  const reconciled = reconcileReviewedFiles(
    scopedRecords,
    provider.repoInfo.key,
    provider.pr.number,
    provider.pr.head.sha,
    identities,
  );
  const otherRecords = allRecords.filter(
    (record) => !isReviewedFileScope(record, provider.repoInfo, provider.pr),
  );

  await queueReviewedStateWrite(() =>
    workspaceState.update(REVIEWED_FILES_STATE_KEY, [...otherRecords, ...reconciled]),
  );
  for (const record of reconciled) provider.markViewed(record.filename);
}

async function persistReviewedFiles(
  workspaceState: vscode.Memento,
  api: GiteaApiClient,
  provider: PRDiffProvider,
  filenames: string[],
  viewed: boolean,
  suppliedIdentities?: CurrentReviewedFileIdentity[],
): Promise<void> {
  if (filenames.length === 0) return;
  const selected = new Set(filenames);
  const identities =
    suppliedIdentities ??
    (await currentReviewedFileIdentities(api, provider.repoInfo, provider.pr));
  const identityByFilename = new Map(
    identities.map((identity) => [identity.filename, identity] as const),
  );

  await queueReviewedStateWrite(async () => {
    const allRecords = storedReviewedFiles(workspaceState);
    const retained = allRecords.filter(
      (record) =>
        !(
          isReviewedFileScope(record, provider.repoInfo, provider.pr) &&
          selected.has(record.filename)
        ),
    );
    const additions: ReviewedFileRecord[] = viewed
      ? filenames.flatMap((filename) => {
          const identity = identityByFilename.get(filename);
          if (!identity) return [];
          return [
            {
              repositoryKey: provider.repoInfo.key,
              pullRequestNumber: provider.pr.number,
              filename,
              reviewedAtHead: provider.pr.head.sha,
              fingerprint: identity.fingerprint,
            },
          ];
        })
      : [];
    await workspaceState.update(REVIEWED_FILES_STATE_KEY, [
      ...retained,
      ...additions,
    ]);
  });
}

function storedReviewedFiles(workspaceState: vscode.Memento): ReviewedFileRecord[] {
  const value = workspaceState.get<unknown>(REVIEWED_FILES_STATE_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is ReviewedFileRecord => {
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Partial<ReviewedFileRecord>;
    return (
      typeof record.repositoryKey === "string" &&
      typeof record.pullRequestNumber === "number" &&
      typeof record.filename === "string" &&
      typeof record.reviewedAtHead === "string" &&
      (record.fingerprint === undefined || typeof record.fingerprint === "string")
    );
  });
}

function isReviewedFileScope(
  record: ReviewedFileRecord,
  repoInfo: RepoInfo,
  pr: GiteaPullRequest,
): boolean {
  return (
    record.repositoryKey === repoInfo.key &&
    record.pullRequestNumber === pr.number
  );
}

function queueReviewedStateWrite(operation: () => PromiseLike<void>): Promise<void> {
  reviewedStateWrite = reviewedStateWrite.then(operation, operation);
  return reviewedStateWrite;
}

async function currentReviewedFileIdentities(
  api: GiteaApiClient,
  repoInfo: RepoInfo,
  pr: GiteaPullRequest,
): Promise<CurrentReviewedFileIdentity[]> {
  const cacheKey = `${repoInfo.key}#${pr.number}@${pr.head.sha}`;
  const cached = reviewedFileIdentityCache.get(cacheKey);
  if (cached) return cached;

  const [files, rawDiff] = await Promise.all([
    api.listPRFiles(repoInfo, pr.number),
    api.getPRRawDiff(repoInfo, pr.number).catch(() => ""),
  ]);
  const patches = parseRawDiffPatches(rawDiff);
  const identities = (files ?? []).map((file: GiteaFileDiff) => ({
    filename: file.filename,
    fingerprint: fingerprintPatch(patches.get(file.filename) ?? file.patch),
  }));
  reviewedFileIdentityCache.set(cacheKey, identities);
  return identities;
}

function parseRawDiffPatches(raw: string): Map<string, string> {
  const patches = new Map<string, string>();
  for (const block of raw.split(/^diff --git /m).slice(1)) {
    const firstLine = block.split("\n")[0];
    const match = firstLine.match(/ b\/(.+)$/);
    if (!match) continue;
    const hunkIndex = block.indexOf("\n@@");
    if (hunkIndex >= 0) {
      patches.set(match[1].trim(), block.slice(hunkIndex + 1));
    }
  }
  return patches;
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
