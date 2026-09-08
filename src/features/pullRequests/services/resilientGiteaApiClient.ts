import { GiteaApiClient } from "../../../api/giteaApiClient";
import { isGiteaApiError } from "../../../api/giteaApiError";
import type { RepoInfo } from "../../../context/repoManager";
import { debug, trace, warn } from "../../../debug/outputChannel";

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 12000];

/**
 * Gitea can transiently return 405 "Please try again later" while its
 * asynchronous pull-request conflict/mergeability checker is still running.
 * The REST merge endpoint itself documents 405 for non-ready merge states.
 *
 * Keep the generic API client behavior intact and only retry this one
 * explicitly transient server response. Permission/WIP/validation failures
 * remain terminal and are surfaced immediately.
 *
 * Between retries we re-read the PR. Gitea explicitly treats GET
 * /pulls/{index} as a "view" and uses it to resume a delayed mergeability
 * check when the PR is in checking state. This makes the retry bounded and
 * observable instead of blindly hammering the merge endpoint.
 */
export class ResilientGiteaApiClient extends GiteaApiClient {
  override async mergePullRequest(
    repoInfo: RepoInfo,
    number: number,
    method: "merge" | "rebase" | "squash" = "merge",
    message?: string,
  ): Promise<void> {
    let attempt = 0;

    for (;;) {
      try {
        debug(
          `[merge-api] attempt=${attempt + 1} repo=${repoInfo.label} pr=#${number} method=${method}`,
        );
        await super.mergePullRequest(repoInfo, number, method, message);
        debug(
          `[merge-api] accepted repo=${repoInfo.label} pr=#${number} method=${method} attempt=${attempt + 1}`,
        );
        return;
      } catch (error) {
        const messageText = (error as Error).message;
        const transient =
          isGiteaApiError(error) &&
          error.status === 405 &&
          /please try again later/i.test(error.detail ?? "");

        if (!transient || attempt >= RETRY_DELAYS_MS.length) {
          warn(
            `[merge-api] failed repo=${repoInfo.label} pr=#${number} attempt=${attempt + 1}: ${messageText}`,
          );
          throw error;
        }

        const delay = RETRY_DELAYS_MS[attempt];
        debug(
          `[merge-api] mergeability pending repo=${repoInfo.label} pr=#${number} retryInMs=${delay}`,
        );
        await sleep(delay);

        try {
          const refreshed = await super.getPullRequest(repoInfo, number);
          trace(
            `[merge-api] recheck repo=${repoInfo.label} pr=#${number} state=${refreshed.state} merged=${Boolean(refreshed.merged)} mergeable=${String(refreshed.mergeable)}`,
          );
        } catch (refreshError) {
          debug(
            `[merge-api] recheck failed repo=${repoInfo.label} pr=#${number}: ${(refreshError as Error).message}`,
          );
        }

        attempt += 1;
      }
    }
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
