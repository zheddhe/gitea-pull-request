import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoInfo } from "../context/repoManager";
import type { GiteaPullRequest, GiteaFileDiff, GiteaCommit, GiteaReview } from "../api/types";

// ── Directory tree builder ────────────────────────────────────────────────────

interface DirNode {
  name: string;
  path: string;
  children: Map<string, DirNode>;
  files: GiteaFileDiff[];
}

function buildDirTree(files: GiteaFileDiff[]): DirNode {
  const root: DirNode = { name: "", path: "", children: new Map(), files: [] };
  for (const file of files) {
    const parts = file.filename.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: node.path ? `${node.path}/${part}` : part,
          children: new Map(),
          files: [],
        });
      }
      node = node.children.get(part)!;
    }
    node.files.push(file);
  }
  return root;
}

function findDirNode(root: DirNode | null, path: string): DirNode | null {
  if (!root) return null;
  const parts = path.split("/");
  let node = root;
  for (const part of parts) {
    const child = node.children.get(part);
    if (!child) return null;
    node = child;
  }
  return node;
}

// ── Tree Item Types ───────────────────────────────────────────────────────────

class PRDiffRootItem extends vscode.TreeItem {
  constructor(pr: GiteaPullRequest) {
    super(`#${pr.number} ${pr.title}`, vscode.TreeItemCollapsibleState.None);
    this.id = "prDiffRoot";
    this.contextValue = "prDiffRoot";
    this.iconPath = new vscode.ThemeIcon("git-pull-request");
  }
}

class PRDiffBranchItem extends vscode.TreeItem {
  constructor(pr: GiteaPullRequest) {
    super(`${pr.head.ref} → ${pr.base.ref}`, vscode.TreeItemCollapsibleState.None);
    this.id = "prDiffBranch";
    this.iconPath = new vscode.ThemeIcon("git-branch");
  }
}

class PRDiffStatsItem extends vscode.TreeItem {
  constructor(additions: number, deletions: number, files: number) {
    super(`+${additions} / -${deletions}`, vscode.TreeItemCollapsibleState.None);
    this.id = "prDiffStats";
    this.description = `${files} file(s) changed`;
    this.iconPath = new vscode.ThemeIcon("diff-multiple");
  }
}

class PRDiffSectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    id: string,
    count: number,
    icon: vscode.ThemeIcon,
    collapsed = true,
  ) {
    super(
      `${label} (${count})`,
      collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    );
    this.id = id;
    this.contextValue = "prDiffSection";
    this.iconPath = icon;
  }
}

class PRDiffDirItem extends vscode.TreeItem {
  constructor(
    public readonly dirPath: string,
    public readonly name: string,
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `dir:${dirPath}`;
    this.contextValue = "prDiffDir";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

class PRDiffFileItem extends vscode.TreeItem {
  constructor(
    public readonly filename: string,
    public readonly fileStatus: string,
    public readonly additions: number,
    public readonly deletions: number,
    public readonly repoInfo: RepoInfo,
    public readonly pr: GiteaPullRequest,
  ) {
    super(filename, vscode.TreeItemCollapsibleState.None);
    this.id = `file:${filename}`;
    this.contextValue = "prDiffFile";
    this.description = `+${additions} / -${deletions}`;
    const statusIcon = fileStatus === "added" ? "add" : fileStatus === "deleted" ? "remove" : "edit";
    const statusColor = fileStatus === "added" ? "green" : fileStatus === "deleted" ? "red" : "orange";
    this.iconPath = new vscode.ThemeIcon(statusIcon, new vscode.ThemeColor(`charts.${statusColor}`));
    this.tooltip = new vscode.MarkdownString(
      `**${filename}**\nStatus: ${fileStatus}\n+${additions} / -${deletions}`,
    );
    this.command = {
      command: "gitea.openFileDiff",
      title: "Open file diff",
      arguments: [repoInfo, pr, filename],
    };
  }
}

class PRDiffCommitItem extends vscode.TreeItem {
  constructor(commit: GiteaCommit) {
    super(commit.commit.message.split("\n")[0], vscode.TreeItemCollapsibleState.None);
    this.id = `commit:${commit.sha}`;
    this.description = commit.sha.slice(0, 7);
    this.iconPath = new vscode.ThemeIcon("git-commit");
    this.tooltip = new vscode.MarkdownString(
      `${commit.commit.message}\n\nBy ${commit.commit.author.name}\n${new Date(commit.commit.author.date).toLocaleString()}`,
    );
  }
}

class PRDiffReviewItem extends vscode.TreeItem {
  constructor(review: GiteaReview) {
    super(review.user.login, vscode.TreeItemCollapsibleState.None);
    this.id = `review:${review.id}`;
    const stateLabel = review.state.replace(/_/g, " ");
    this.description = stateLabel;
    const color =
      review.state === "APPROVED" ? "green"
        : review.state === "REQUEST_CHANGES" ? "red"
          : "blue";
    this.iconPath = new vscode.ThemeIcon("comment", new vscode.ThemeColor(`charts.${color}`));
    if (review.body?.trim()) {
      this.tooltip = new vscode.MarkdownString(review.body);
    }
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class PRDiffProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private static instances = new Map<string, PRDiffProvider>();
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: GiteaFileDiff[] = [];
  private commits: GiteaCommit[] = [];
  private reviews: GiteaReview[] = [];
  private dirTree: DirNode | null = null;
  private loading = false;
  private error: string | null = null;
  private disposable: vscode.Disposable | null = null;

  private constructor(
    private readonly api: GiteaApiClient,
    public readonly repoInfo: RepoInfo,
    public readonly pr: GiteaPullRequest,
  ) {}

  static async show(
    api: GiteaApiClient,
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
  ): Promise<void> {
    const key = `${repoInfo.key}:${pr.number}`;
    const existing = PRDiffProvider.instances.get(key);
    if (existing) {
      await vscode.commands.executeCommand("gitea.prDiff.focus");
      return;
    }

    // Set context to show the view
    await vscode.commands.executeCommand("setContext", "gitea.prDiffVisible", true);

    const provider = new PRDiffProvider(api, repoInfo, pr);
    provider.disposable = vscode.window.registerTreeDataProvider("gitea.prDiff", provider);
    PRDiffProvider.instances.set(key, provider);

    // Focus the view
    await vscode.commands.executeCommand("gitea.prDiff.focus");
  }

  static hide(key: string): void {
    const provider = PRDiffProvider.instances.get(key);
    if (provider) {
      provider.disposable?.dispose();
      PRDiffProvider.instances.delete(key);
    }
  }

  static clearAll(): void {
    for (const provider of PRDiffProvider.instances.values()) {
      provider.dispose();
    }
    PRDiffProvider.instances.clear();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      // Root level
      if (this.error) {
        const item = new vscode.TreeItem(this.error, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("warning");
        return [item];
      }
      if (this.loading) {
        const item = new vscode.TreeItem("Loading...", vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("loading~spin");
        return [item];
      }
      if (this.files.length === 0) {
        // First load — fetch data
        this.loading = true;
        this._onDidChangeTreeData.fire();
        try {
          const [files, commits, reviews] = await Promise.all([
            this.api.listPRFiles(this.repoInfo, this.pr.number),
            this.api.listPRCommits(this.repoInfo, this.pr.number),
            this.api.listReviews(this.repoInfo, this.pr.number),
          ]);
          this.files = files;
          this.commits = commits;
          this.reviews = reviews;
          this.dirTree = buildDirTree(files);
        } catch (err) {
          this.error = `Failed to load PR diff: ${(err as Error).message}`;
        } finally {
          this.loading = false;
          this._onDidChangeTreeData.fire();
        }
        return [];
      }

      const additions = this.files.reduce((sum, f) => sum + f.additions, 0);
      const deletions = this.files.reduce((sum, f) => sum + f.deletions, 0);

      return [
        new PRDiffRootItem(this.pr),
        new PRDiffBranchItem(this.pr),
        new PRDiffStatsItem(additions, deletions, this.files.length),
        new PRDiffSectionItem("Files", "files", this.files.length, new vscode.ThemeIcon("file-directory")),
        new PRDiffSectionItem("Commits", "commits", this.commits.length, new vscode.ThemeIcon("git-commit")),
        new PRDiffSectionItem("Reviews", "reviews", this.reviews.length, new vscode.ThemeIcon("comment-discussion")),
      ];
    }

    if (element instanceof PRDiffSectionItem) {
      if (element.id === "files") {
        return this.dirTree ? this.dirNodeToTreeItems(this.dirTree) : [];
      }
      if (element.id === "commits") {
        return this.commits.map((c) => new PRDiffCommitItem(c));
      }
      if (element.id === "reviews") {
        return this.reviews.map((r) => new PRDiffReviewItem(r));
      }
    }

    if (element instanceof PRDiffDirItem) {
      const node = findDirNode(this.dirTree, element.dirPath);
      return node ? this.dirNodeToTreeItems(node) : [];
    }

    return [];
  }

  private dirNodeToTreeItems(node: DirNode): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    // Files first
    for (const file of node.files) {
      items.push(new PRDiffFileItem(
        file.filename,
        file.status,
        file.additions,
        file.deletions,
        this.repoInfo,
        this.pr,
      ));
    }
    // Then directories (sorted)
    for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      items.push(new PRDiffDirItem(child.path, child.name));
    }
    return items;
  }

  dispose(): void {
    this.disposable?.dispose();
    this.disposable = null;
  }
}
