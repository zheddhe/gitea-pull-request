import { GiteaApiClient } from "../../../api/giteaApiClient";
import type { RepoInfo } from "../../../context/repoManager";
import { log } from "../../../debug/outputChannel";

const RETRY_DELAYS_MS = [750, 1500, 2500];

/**
 * Gitea can transiently return 405 "Please try again later" while its
 * asynchronous pull-request conflict/mergeability checker is still running.
 * The REST merge endpoint itself documents 405 for non-ready merge states.
 *
 * Keep the generic API client behavior intact and only retry this one
 * explicitly transient server response. Permission/WIP/validation failures
 * remain terminal and are surfaced immediately.
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
        log(
          `[merge-api] merge attempt=${attempt + 1} repo=${repoInfo.label} pr=#${number} method=${method}`,
        );
        await super.mergePullRequest(repoInfo, number, method, message);
        log(
          `[merge-api] merge accepted repo=${repoInfo.label} pr=#${number} method=${method} attempt=${attempt + 1}`,
        );
        return;
      } catch (error) {
        const messageText = (error as Error).message;
        const transient =
          /405\s+Method Not Allowed/i.test(messageText) &&
          /please try again later/i.test(messageText);

        if (!transient || attempt >= RETRY_DELAYS_MS.length) {
          log(
            `[merge-api] merge failed repo=${repoInfo.label} pr=#${number} attempt=${attempt + 1}: ${messageText}`,
          );
          throw error;
        }

        const delay = RETRY_DELAYS_MS[attempt];
        log(
          `[merge-api] Gitea mergeability check still running for pr=#${number}; retrying in ${delay}ms`,
        );
        await sleep(delay);
        attempt += 1;
      }
    }
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
