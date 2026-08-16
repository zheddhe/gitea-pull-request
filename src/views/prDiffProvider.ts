import * as vscode from "vscode";
import { GiteaApiClient } from "../api/giteaApiClient";
import { RepoInfo } from "../context/repoManager";
import { log } from "../debug/outputChannel";
import type { GiteaPullRequest, GiteaFileDiff, GiteaCommit, GiteaReview } from "../api/types";

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

class PRDiffRootItem extends vscode.TreeItem {
  constructor(pr: GiteaPullRequest, hasApproved: boolean) {
    super(`#${pr.number} ${pr.title}`, vscode.TreeItemCollapsibleState.Expanded);
    this.id = "prDiffRoot";
    this.contextValue = "prDiffRoot";
    const color = hasApproved
      ? new vscode.ThemeColor("charts.green")
      : new vscode.ThemeColor("charts.yellow");
    this.iconPath = new vscode.ThemeIcon("git-pull-request", color);
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

class PRDiffEmptyItem extends vscode.TreeItem {
  constructor() {
    super("No changes", vscode.TreeItemCollapsibleState.None);
    this.id = "prDiffEmpty";
    this.description = "Head branch is already contained in the target branch";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

export class PRDiffSectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly id: string,
    count: number,
    icon: vscode.ThemeIcon,
    collapsed = true,
  ) {
    super(
      `${label} (${count})`,
      collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    );
    this.contextValue = "prDiffSection";
    this.iconPath = icon;
  }
}

export class PRDiffDirItem extends vscode.TreeItem {
  constructor(
    public readonly dirPath: string,
    public readonly name: string,
    checkboxState: vscode.TreeItemCheckboxState,
  ) {
    super(name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `dir:${dirPath}`;
    this.contextValue = "prDiffDir";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.checkboxState = checkboxState;
    this.command = {
      command: "gitea.prDiffDirAction",
      title: "PR Diff Dir Action",
      arguments: [this],
    };
  }
}

export class PRDiffFileItem extends vscode.TreeItem {
  constructor(
    public readonly filename: string,
    public readonly fileStatus: string,
    public readonly additions: number,
    public readonly deletions: number,
    public readonly repoInfo: RepoInfo,
    public readonly pr: GiteaPullRequest,
    viewed: boolean,
  ) {
    super(filename, vscode.TreeItemCollapsibleState.None);
    this.id = `file:${filename}`;
    this.contextValue = viewed ? "prDiffFileViewed" : "prDiffFile";
    this.description = `+${additions} / -${deletions}`;
    this.resourceUri = vscode.Uri.file(filename);
    this.tooltip = new vscode.MarkdownString(
      `**${filename}**\nStatus: ${fileStatus}\n+${additions} / -${deletions}`,
    );
    this.checkboxState = viewed
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = {
      command: "gitea.prDiffFileAction",
      title: "PR Diff File Action",
      arguments: [this],
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

export class PRDiffProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private static instances = new Map<string, PRDiffProvider>();
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: GiteaFileDiff[] = [];
  private commits: GiteaCommit[] = [];
  private reviews: GiteaReview[] = [];
  private dirTree: DirNode | null = null;
  private loading = false;
  private loaded = false;
  private loadVersion = 0;
  private error: string | null = null;
  private disposable: vscode.Disposable | null = null;
  private viewedFiles = new Set<string>();

  private constructor(
    private readonly _api: GiteaApiClient,
    public repoInfo: RepoInfo,
    public pr: GiteaPullRequest,
  ) {}

  get api(): GiteaApiClient {
    return this._api;
  }

  static async show(
    api: GiteaApiClient,
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
  ): Promise<void> {
    const key = `${repoInfo.key}:${pr.number}`;
    let provider = PRDiffProvider.instances.get(key);

    for (const [k, p] of PRDiffProvider.instances.entries()) {
      if (k !== key) {
        p.dispose();
        PRDiffProvider.instances.delete(k);
      }
    }

    if (provider) {
      provider.rebind(repoInfo, pr);
      await vscode.commands.executeCommand("gitea.prDiff.focus");
      return;
    }

    await vscode.commands.executeCommand("setContext", "gitea.prDiffVisible", true);

    provider = new PRDiffProvider(api, repoInfo, pr);
    provider.disposable = vscode.window.registerTreeDataProvider("gitea.prDiff", provider);
    PRDiffProvider.instances.set(key, provider);

    await vscode.commands.executeCommand("gitea.prDiff.focus");
  }

  private rebind(repoInfo: RepoInfo, pr: GiteaPullRequest): void {
    const previousHead = this.pr.head.sha;
    const changed =
      previousHead !== pr.head.sha ||
      this.pr.title !== pr.title ||
      this.pr.base.ref !== pr.base.ref ||
      this.pr.head.ref !== pr.head.ref;
    this.repoInfo = repoInfo;
    this.pr = pr;
    if (!changed) {
      this._onDidChangeTreeData.fire(null);
      return;
    }

    this.loadVersion += 1;
    this.loaded = false;
    this.error = null;
    this.files = [];
    this.commits = [];
    this.reviews = [];
    this.dirTree = null;
    this.viewedFiles.clear();
    log(
      `[pr-diff] rebind repo=${repoInfo.label} pr=#${pr.number} head=${previousHead.slice(0, 7)}->${pr.head.sha.slice(0, 7)}`,
    );
    this._onDidChangeTreeData.fire(null);
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

  static getActive(): PRDiffProvider | undefined {
    for (const p of PRDiffProvider.instances.values()) return p;
    return undefined;
  }

  markViewed(filename: string): void {
    this.viewedFiles.add(filename);
    this._onDidChangeTreeData.fire(null);
  }

  markUnviewed(filename: string): void {
    this.viewedFiles.delete(filename);
    this._onDidChangeTreeData.fire(null);
  }

  toggleDirViewed(dirPath: string, check: boolean): void {
    const node = findDirNode(this.dirTree, dirPath);
    if (!node) return;
    const filenames = this.collectFilenames(node);
    for (const f of filenames) {
      if (check) this.viewedFiles.add(f);
      else this.viewedFiles.delete(f);
    }
    this._onDidChangeTreeData.fire(null);
  }

  toggleAllViewed(check: boolean): void {
    if (check) {
      for (const f of this.files) this.viewedFiles.add(f.filename);
    } else {
      this.viewedFiles.clear();
    }
    this._onDidChangeTreeData.fire(null);
  }

  private collectFilenames(node: DirNode): string[] {
    const result: string[] = [];
    for (const f of node.files) result.push(f.filename);
    for (const child of node.children.values()) {
      result.push(...this.collectFilenames(child));
    }
    return result;
  }

  getDirCheckboxState(dirPath: string): vscode.TreeItemCheckboxState {
    const node = findDirNode(this.dirTree, dirPath);
    if (!node) return vscode.TreeItemCheckboxState.Unchecked;
    const filenames = this.collectFilenames(node);
    if (filenames.length === 0) return vscode.TreeItemCheckboxState.Unchecked;
    const viewedCount = filenames.filter(f => this.viewedFiles.has(f)).length;
    if (viewedCount === 0) return vscode.TreeItemCheckboxState.Unchecked;
    if (viewedCount === filenames.length) return vscode.TreeItemCheckboxState.Checked;
    return 2 as unknown as vscode.TreeItemCheckboxState;
  }

  getSectionCheckboxState(): vscode.TreeItemCheckboxState {
    if (this.files.length === 0) return vscode.TreeItemCheckboxState.Unchecked;
    const viewedCount = this.files.filter(f => this.viewedFiles.has(f.filename)).length;
    if (viewedCount === 0) return vscode.TreeItemCheckboxState.Unchecked;
    if (viewedCount === this.files.length) return vscode.TreeItemCheckboxState.Checked;
    return 2 as unknown as vscode.TreeItemCheckboxState;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
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
      if (!this.loaded) {
        this.loading = true;
        const loadVersion = this.loadVersion;
        this._onDidChangeTreeData.fire(null);
        log(`[pr-diff] loading repo=${this.repoInfo.label} pr=#${this.pr.number}`);
        try {
          const [files, commits, reviews] = await Promise.all([
            this._api.listPRFiles(this.repoInfo, this.pr.number),
            this._api.listPRCommits(this.repoInfo, this.pr.number),
            this._api.listReviews(this.repoInfo, this.pr.number),
          ]);
          if (loadVersion !== this.loadVersion) {
            log(`[pr-diff] discarded stale load repo=${this.repoInfo.label} pr=#${this.pr.number}`);
            return [];
          }
          this.files = files ?? [];
          this.commits = commits ?? [];
          this.reviews = reviews ?? [];
          this.dirTree = buildDirTree(this.files);
          this.loaded = true;
          log(
            `[pr-diff] loaded repo=${this.repoInfo.label} pr=#${this.pr.number} files=${this.files.length} commits=${this.commits.length} reviews=${this.reviews.length}`,
          );
        } catch (err) {
          if (loadVersion === this.loadVersion) {
            this.error = `Failed to load PR diff: ${(err as Error).message}`;
            log(`[pr-diff] load failed repo=${this.repoInfo.label} pr=#${this.pr.number}: ${(err as Error).message}`);
          }
        } finally {
          this.loading = false;
          this._onDidChangeTreeData.fire(null);
        }
        return [];
      }

      const additions = this.files.reduce((sum, f) => sum + f.additions, 0);
      const deletions = this.files.reduce((sum, f) => sum + f.deletions, 0);
      const hasApproved = this.reviews.some((r) => r.state === "APPROVED" && !r.stale);

      if (this.files.length === 0) {
        return [
          new PRDiffRootItem(this.pr, hasApproved),
          new PRDiffBranchItem(this.pr),
          new PRDiffStatsItem(0, 0, 0),
          new PRDiffEmptyItem(),
          new PRDiffSectionItem("Commits", "commits", this.commits.length, new vscode.ThemeIcon("git-commit")),
          new PRDiffSectionItem("Reviews", "reviews", this.reviews.length, new vscode.ThemeIcon("comment-discussion")),
        ];
      }

      const filesSection = new PRDiffSectionItem("Files", "files", this.files.length, new vscode.ThemeIcon("file-directory"), false);
      const sectionState = this.getSectionCheckboxState();
      filesSection.checkboxState = sectionState;
      filesSection.command = {
        command: "gitea.prDiffSectionAction",
        title: "PR Diff Section Action",
        arguments: [filesSection],
      };

      return [
        new PRDiffRootItem(this.pr, hasApproved),
        new PRDiffBranchItem(this.pr),
        new PRDiffStatsItem(additions, deletions, this.files.length),
        filesSection,
        new PRDiffSectionItem("Commits", "commits", this.commits.length, new vscode.ThemeIcon("git-commit")),
        new PRDiffSectionItem("Reviews", "reviews", this.reviews.length, new vscode.ThemeIcon("comment-discussion")),
      ];
    }

    if (element instanceof PRDiffSectionItem) {
      if (element.id === "files") {
        return this.dirTree ? this.dirNodeToTreeItems(this.dirTree, this.viewedFiles) : [];
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
      return node ? this.dirNodeToTreeItems(node, this.viewedFiles) : [];
    }

    return [];
  }

  private dirNodeToTreeItems(node: DirNode, viewedFiles: Set<string>): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    for (const file of node.files) {
      const viewed = viewedFiles.has(file.filename);
      items.push(new PRDiffFileItem(
        file.filename,
        file.status,
        file.additions,
        file.deletions,
        this.repoInfo,
        this.pr,
        viewed,
      ));
    }
    for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      const checkboxState = this.getDirCheckboxState(child.path);
      items.push(new PRDiffDirItem(child.path, child.name, checkboxState));
    }
    return items;
  }

  dispose(): void {
    this.disposable?.dispose();
    this.disposable = null;
  }
}
