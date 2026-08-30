import type * as vscode from "vscode";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { GiteaFileDiff, GiteaPullRequest } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import {
  fingerprintPatch,
  reconcileReviewedFiles,
  type CurrentReviewedFileIdentity,
  type ReviewedFileRecord,
} from "../domain/reviewedFileState";

const REVIEWED_FILES_STATE_KEY = "gitea.prDiff.reviewedFiles.v1";

export class ReviewedFileStateService {
  private readonly identityCache = new Map<
    string,
    CurrentReviewedFileIdentity[]
  >();
  private stateWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly api: GiteaApiClient,
  ) {}

  async reconcile(repoInfo: RepoInfo, pr: GiteaPullRequest): Promise<string[]> {
    const identities = await this.currentIdentities(repoInfo, pr);
    const allRecords = this.storedRecords();
    const scopedRecords = allRecords.filter((record) =>
      this.isScope(record, repoInfo, pr),
    );
    const reconciled = reconcileReviewedFiles(
      scopedRecords,
      repoInfo.key,
      pr.number,
      pr.head.sha,
      identities,
    );
    const otherRecords = allRecords.filter(
      (record) => !this.isScope(record, repoInfo, pr),
    );

    await this.queueWrite(() =>
      this.workspaceState.update(REVIEWED_FILES_STATE_KEY, [
        ...otherRecords,
        ...reconciled,
      ]),
    );
    return reconciled.map((record) => record.filename);
  }

  async setReviewed(
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
    filenames: string[],
    reviewed: boolean,
  ): Promise<void> {
    if (filenames.length === 0) return;
    const selected = new Set(filenames);
    const identities = await this.currentIdentities(repoInfo, pr);
    const identityByFilename = new Map(
      identities.map((identity) => [identity.filename, identity] as const),
    );

    await this.queueWrite(async () => {
      const allRecords = this.storedRecords();
      const retained = allRecords.filter(
        (record) =>
          !(
            this.isScope(record, repoInfo, pr) && selected.has(record.filename)
          ),
      );
      const additions: ReviewedFileRecord[] = reviewed
        ? filenames.flatMap((filename) => {
            const identity = identityByFilename.get(filename);
            if (!identity) return [];
            return [
              {
                repositoryKey: repoInfo.key,
                pullRequestNumber: pr.number,
                filename,
                reviewedAtHead: pr.head.sha,
                fingerprint: identity.fingerprint,
              },
            ];
          })
        : [];
      await this.workspaceState.update(REVIEWED_FILES_STATE_KEY, [
        ...retained,
        ...additions,
      ]);
    });
  }

  async filenamesUnder(
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
    dirPath: string,
  ): Promise<string[]> {
    const prefix = `${dirPath}/`;
    return (await this.currentIdentities(repoInfo, pr))
      .map((identity) => identity.filename)
      .filter((filename) => filename.startsWith(prefix));
  }

  async allFilenames(repoInfo: RepoInfo, pr: GiteaPullRequest): Promise<string[]> {
    return (await this.currentIdentities(repoInfo, pr)).map(
      (identity) => identity.filename,
    );
  }

  private storedRecords(): ReviewedFileRecord[] {
    const value = this.workspaceState.get<unknown>(REVIEWED_FILES_STATE_KEY);
    if (!Array.isArray(value)) return [];
    return value.filter((candidate): candidate is ReviewedFileRecord => {
      if (!candidate || typeof candidate !== "object") return false;
      const record = candidate as Partial<ReviewedFileRecord>;
      return (
        typeof record.repositoryKey === "string" &&
        typeof record.pullRequestNumber === "number" &&
        typeof record.filename === "string" &&
        typeof record.reviewedAtHead === "string" &&
        (record.fingerprint === undefined ||
          typeof record.fingerprint === "string")
      );
    });
  }

  private isScope(
    record: ReviewedFileRecord,
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
  ): boolean {
    return (
      record.repositoryKey === repoInfo.key &&
      record.pullRequestNumber === pr.number
    );
  }

  private queueWrite(operation: () => PromiseLike<void>): Promise<void> {
    this.stateWrite = this.stateWrite.then(operation, operation);
    return this.stateWrite;
  }

  private async currentIdentities(
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
  ): Promise<CurrentReviewedFileIdentity[]> {
    const cacheKey = `${repoInfo.key}#${pr.number}@${pr.head.sha}`;
    const cached = this.identityCache.get(cacheKey);
    if (cached) return cached;

    const [files, rawDiff] = await Promise.all([
      this.api.listPRFiles(repoInfo, pr.number),
      this.api.getPRRawDiff(repoInfo, pr.number).catch(() => ""),
    ]);
    const patches = parseRawDiffPatches(rawDiff);
    const identities = (files ?? []).map((file: GiteaFileDiff) => ({
      filename: file.filename,
      fingerprint: fingerprintPatch(patches.get(file.filename) ?? file.patch),
    }));
    this.identityCache.set(cacheKey, identities);
    return identities;
  }
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
