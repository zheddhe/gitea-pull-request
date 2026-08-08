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
import { PRDiffProvider } from "../views/prDiffProvider";
import type { GiteaPullRequest } from "../api/types";

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
      async (item: PullRequestItem) => {
        await PRDetailPanel.show(
          context.extensionUri,
          api,
          item.repoInfo,
          item.pr,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.openPRDiff",
      async (item: PullRequestItem) => {
        await PRDiffProvider.show(api, item.repoInfo, item.pr);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.openFileDiff",
      async (repoInfo: RepoInfo, pr: GiteaPullRequest, filename: string) => {
        await openFileDiff(api, repoInfo, pr, filename);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.checkoutPR",
      async (arg: PullRequestItem | GiteaPullRequest, repoInfo?: RepoInfo) => {
        const pr = arg instanceof PullRequestItem ? arg.pr : arg;
        const ri =
          arg instanceof PullRequestItem ? arg.repoInfo : repoInfo;
        await checkoutPR(pr, ri);
      },
    ),

    vscode.commands.registerCommand("gitea.createPR", async () => {
      await createPR(api, repoManager, auth, prProvider);
    }),

    vscode.commands.registerCommand(
      "gitea.mergePR",
      async (arg: PullRequestItem) => {
        if (!(arg instanceof PullRequestItem)) {
          return;
        }
        await mergePR(api, arg.pr, arg.repoInfo, prProvider);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.approvePR",
      async (arg: PullRequestItem) => {
        if (!(arg instanceof PullRequestItem)) {
          return;
        }
        await reviewPR(api, arg.pr, arg.repoInfo, "APPROVED", prProvider);
      },
    ),

    vscode.commands.registerCommand(
      "gitea.requestChangesPR",
      async (arg: PullRequestItem) => {
        if (!(arg instanceof PullRequestItem)) {
          return;
        }
        await reviewPR(
          api,
          arg.pr,
          arg.repoInfo,
          "REQUEST_CHANGES",
          prProvider,
        );
      },
    ),

    vscode.commands.registerCommand(
      "gitea.addComment",
      async (arg?: PullRequestItem) => {
        if (arg instanceof PullRequestItem) {
          await addComment(api, arg.repoInfo, arg.pr.number, prProvider);
        } else {
          // invoked from command palette — pick a repo then enter PR number
          const repoInfo = await pickRepo(repoManager, auth);
          if (!repoInfo) {
            return;
          }
          const numStr = await vscode.window.showInputBox({
            prompt: "PR number",
            validateInput: (v) => (/^\d+$/.test(v) ? null : "Enter a number"),
          });
          if (!numStr) {
            return;
          }
          await addComment(api, repoInfo, parseInt(numStr, 10), prProvider);
        }
      },
    ),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pickRepo(
  repoManager: RepoManager,
  auth: AuthManager,
): Promise<RepoInfo | undefined> {
  const repos = repoManager.getRepos();
  if (repos.length === 0) {
    vscode.window.showErrorMessage("No Gitea repositories detected.");
    return undefined;
  }
  if (repos.length === 1) {
    return repos[0];
  }
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

async function checkoutPR(
  pr: GiteaPullRequest,
  repoInfo?: RepoInfo,
): Promise<void> {
  const branch = pr.head.ref;
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (!gitExt) {
    vscode.window.showErrorMessage("Git extension not available.");
    return;
  }
  const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  const allRepos = git.getAPI(1).repositories;
  if (allRepos.length === 0) {
    vscode.window.showErrorMessage("No git repository found in workspace.");
    return;
  }
  // Prefer the git repo matching the detected Gitea repo's root path
  const repo = repoInfo
    ? (allRepos.find(
        (r: { rootUri: vscode.Uri }) => r.rootUri.fsPath === repoInfo.rootPath,
      ) ?? allRepos[0])
    : allRepos[0];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking out ${branch}...`,
    },
    async () => {
      try {
        await repo.fetch({ remote: "origin", ref: branch });
        await repo.checkout(branch);
        vscode.window.showInformationMessage(`Checked out branch: ${branch}`);
      } catch {
        try {
          await repo.checkout(`origin/${branch}`, {
            createNewBranch: true,
            newBranchName: branch,
          });
          vscode.window.showInformationMessage(`Checked out branch: ${branch}`);
        } catch (err2) {
          vscode.window.showErrorMessage(
            `Failed to checkout: ${(err2 as Error).message}`,
          );
        }
      }
    },
  );
}

async function createPR(
  api: GiteaApiClient,
  repoManager: RepoManager,
  auth: AuthManager,
  prProvider: PullRequestProvider,
): Promise<void> {
  const repoInfo = await pickRepo(repoManager, auth);
  if (!repoInfo) {
    return;
  }

  let branches: string[] = [];
  try {
    branches = await api.listBranches(repoInfo);
  } catch {
    /* fall through to text input */
  }

  const head =
    branches.length > 0
      ? await vscode.window.showQuickPick(branches, {
          placeHolder: "Head branch (source)",
        })
      : await vscode.window.showInputBox({
          prompt: "Head branch (source)",
          value: repoInfo.currentBranch ?? "",
        });
  if (!head) {
    return;
  }

  const base =
    branches.length > 0
      ? await vscode.window.showQuickPick(
          branches.filter((b) => b !== head),
          { placeHolder: "Base branch (target)" },
        )
      : await vscode.window.showInputBox({
          prompt: "Base branch (target)",
          value: "main",
        });
  if (!base) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Pull request title",
    validateInput: (v) => (v ? null : "Title is required"),
  });
  if (!title) {
    return;
  }

  const body =
    (await vscode.window.showInputBox({ prompt: "Description (optional)" })) ??
    "";

  let pr: { number: number; html_url: string } | undefined;
  try {
    pr = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Creating pull request...",
      },
      async () => {
        return api.createPullRequest(repoInfo, {
          title,
          body,
          head,
          base,
        });
      },
    );
    const action = await vscode.window.showInformationMessage(
      `PR #${pr.number} created.`,
      "Open in Browser",
    );
    if (action === "Open in Browser") {
      await vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
    }
    prProvider.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to create PR: ${(err as Error).message}`,
    );
  }
}

async function mergePR(
  api: GiteaApiClient,
  pr: GiteaPullRequest,
  repoInfo: RepoInfo,
  prProvider: PullRequestProvider,
): Promise<void> {
  const method = await vscode.window.showQuickPick(
    [
      { label: "Merge commit", value: "merge" },
      { label: "Rebase", value: "rebase" },
      { label: "Squash", value: "squash" },
    ],
    { placeHolder: "Select merge method" },
  );
  if (!method) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Merge PR #${pr.number} (${method.value})?`,
    { modal: true },
    "Merge",
  );
  if (confirm !== "Merge") {
    return;
  }
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Merging PR #${pr.number}...`,
      },
      async () => {
        await api.mergePullRequest(
          repoInfo,
          pr.number,
          method.value as "merge" | "rebase" | "squash",
        );
      },
    );
    vscode.window.showInformationMessage(`PR #${pr.number} merged.`);
    prProvider.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Merge failed: ${(err as Error).message}`,
    );
  }
}

async function reviewPR(
  api: GiteaApiClient,
  pr: GiteaPullRequest,
  repoInfo: RepoInfo,
  event: "APPROVED" | "REQUEST_CHANGES",
  prProvider: PullRequestProvider,
): Promise<void> {
  const body =
    (await vscode.window.showInputBox({
      prompt: "Review comment (optional)",
    })) ?? "";
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Submitting review...`,
      },
      async () => {
        await api.createReview(repoInfo, pr.number, event, body);
      },
    );
    vscode.window.showInformationMessage(`Review submitted: ${event}`);
    prProvider.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Review failed: ${(err as Error).message}`,
    );
  }
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
  if (!body) {
    return;
  }
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
  const tmpDir = path.join(os.tmpdir(), `gitea-diff-${repoInfo.key.replace(/[^a-zA-Z0-9]/g, "_")}-${pr.number}-${Date.now()}`);

  try {
    const [baseContent, headContent] = await Promise.allSettled([
      api.getFileContents(repoInfo, pr.base.ref, filename),
      api.getFileContents(repoInfo, pr.head.ref, filename),
    ]);

    // Handle cases where the file doesn't exist on one branch (added/deleted)
    const baseText = baseContent.status === "fulfilled" ? baseContent.value : "";
    const headText = headContent.status === "fulfilled" ? headContent.value : "";

    // Check if either side looks binary (contains null bytes)
    const hasNullByte = (s: string) => s.includes("\0");
    if (hasNullByte(baseText) || hasNullByte(headText)) {
      vscode.window.showInformationMessage(`File '${filename}' appears to be binary — skipping diff.`);
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

    const title = filename === path.basename(filename)
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
    vscode.window.showErrorMessage(`Failed to open diff for '${filename}': ${(err as Error).message}`);
  }
}
