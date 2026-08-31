import type * as vscode from "vscode";
import type { GiteaApiClient } from "../../../api/giteaApiClient";
import type { GiteaFileDiff, GiteaPullRequest } from "../../../api/types";
import type { RepoInfo } from "../../../context/repoManager";
import { debug, info, warn } from "../../../debug/outputChannel";
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
    const allRecords = this.storedRecords();
    const scopedRecords = allRecords.filter((record) =>
      this.isScope(record, repoInfo, pr),
    );
    const sameHead = scopedRecords.filter(
      (record) => record.reviewedAtHead === pr.head.sha,
    );
    const previousHeads = scopedRecords.filter(
      (record) => record.reviewedAtHead !== pr.head.sha,
    );

    info(
      `[reviewed-files] reconcile repo=${repoInfo.key} pr=#${pr.number} head=${pr.head.sha.slice(0, 8)} stored=${allRecords.length} scoped=${scopedRecords.length} sameHead=${sameHead.length} previousHead=${previousHeads.length}`,
    );
    debug(
      `[reviewed-files] reconcile same-head files=${sameHead.map((record) => record.filename).join(",") || "<none>"}`,
    );

    // Same-head state is authoritative local state. No network request should
    // be required merely to restore a review decision after reload/rebind.
    if (previousHeads.length === 0) {
      return sameHead.map((record) => record.filename);
    }

    let identities: CurrentReviewedFileIdentity[];
    try {
      identities = await this.currentIdentities(repoInfo, pr);
    } catch (error) {
      warn(
        `[reviewed-files] reconcile identities failed repo=${repoInfo.key} pr=#${pr.number}: ${(error as Error).message}`,
      );
      return sameHead.map((record) => record.filename);
    }

    const reconciledPrevious = reconcileReviewedFiles(
      previousHeads,
      repoInfo.key,
      pr.number,
      pr.head.sha,
      identities,
    );
    const reconciled = [...sameHead, ...reconciledPrevious];
    const otherRecords = allRecords.filter(
      (record) => !this.isScope(record, repoInfo, pr),
    );

    await this.queueWrite(() =>
      this.workspaceState.update(REVIEWED_FILES_STATE_KEY, [
        ...otherRecords,
        ...reconciled,
      ]),
    );
    info(
      `[reviewed-files] reconcile migrated=${reconciledPrevious.length} restored=${reconciled.length} repo=${repoInfo.key} pr=#${pr.number}`,
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

    info(
      `[reviewed-files] persist requested reviewed=${reviewed} files=${filenames.length} repo=${repoInfo.key} pr=#${pr.number} head=${pr.head.sha.slice(0, 8)}`,
    );
    debug(
      `[reviewed-files] persist requested filenames=${filenames.join(",")}`,
    );

    // Persist the user's explicit review decision first. Fingerprints are an
    // optional enrichment used only to preserve Reviewed across a later head.
    // A temporary API/diff failure must never make the checkbox state ephemeral.
    await this.queueWrite(async () => {
      const allRecords = this.storedRecords();
      const retained = allRecords.filter(
        (record) =>
          !(
            this.isScope(record, repoInfo, pr) && selected.has(record.filename)
          ),
      );
      const additions: ReviewedFileRecord[] = reviewed
        ? filenames.map((filename) => ({
            repositoryKey: repoInfo.key,
            pullRequestNumber: pr.number,
            filename,
            reviewedAtHead: pr.head.sha,
          }))
        : [];
      const nextRecords = [...retained, ...additions];
      await this.workspaceState.update(REVIEWED_FILES_STATE_KEY, nextRecords);
      info(
        `[reviewed-files] persist committed reviewed=${reviewed} totalStored=${nextRecords.length} repo=${repoInfo.key} pr=#${pr.number}`,
      );
      debug(
        `[reviewed-files] persist scoped-after=${nextRecords
          .filter((record) => this.isScope(record, repoInfo, pr))
          .map((record) => `${record.filename}@${record.reviewedAtHead.slice(0, 8)}`)
          .join(",") || "<none>"}`,
      );
    });

    if (reviewed) {
      void this.enrichFingerprints(repoInfo, pr, selected);
    }
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

  private async enrichFingerprints(
    repoInfo: RepoInfo,
    pr: GiteaPullRequest,
    selected: Set<string>,
  ): Promise<void> {
    let identities: CurrentReviewedFileIdentity[];
    try {
      identities = await this.currentIdentities(repoInfo, pr);
    } catch (error) {
      debug(
        `[reviewed-files] fingerprint enrichment skipped repo=${repoInfo.key} pr=#${pr.number}: ${(error as Error).message}`,
      );
      return;
    }

    const fingerprintByFilename = new Map(
      identities
        .filter(
          (identity) => selected.has(identity.filename) && !!identity.fingerprint,
        )
        .map((identity) => [identity.filename, identity.fingerprint] as const),
    );
    if (fingerprintByFilename.size === 0) {
      debug(
        `[reviewed-files] fingerprint enrichment none repo=${repoInfo.key} pr=#${pr.number}`,
      );
      return;
    }

    await this.queueWrite(async () => {
      const records = this.storedRecords().map((record) => {
        if (
          !this.isScope(record, repoInfo, pr) ||
          record.reviewedAtHead !== pr.head.sha
        ) {
          return record;
        }
        const fingerprint = fingerprintByFilename.get(record.filename);
        return fingerprint ? { ...record, fingerprint } : record;
      });
      await this.workspaceState.update(REVIEWED_FILES_STATE_KEY, records);
      debug(
        `[reviewed-files] fingerprint enrichment committed files=${fingerprintByFilename.size} repo=${repoInfo.key} pr=#${pr.number}`,
      );
    });
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
    if (cached) {
      debug(
        `[reviewed-files] identities cache hit repo=${repoInfo.key} pr=#${pr.number} head=${pr.head.sha.slice(0, 8)} files=${cached.length}`,
      );
      return cached;
    }

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
    debug(
      `[reviewed-files] identities loaded repo=${repoInfo.key} pr=#${pr.number} head=${pr.head.sha.slice(0, 8)} files=${identities.length} fingerprinted=${identities.filter((identity) => !!identity.fingerprint).length}`,
    );
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
