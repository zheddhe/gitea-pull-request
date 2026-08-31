export interface GiteaServerCapabilities {
  version: string;
  inlineReviewResolution: boolean;
  inlineReviewReplies: boolean;
}

const INLINE_REVIEW_RESOLUTION_MIN_VERSION = [1, 26, 0] as const;
const INLINE_REVIEW_REPLIES_MIN_VERSION = [1, 27, 0] as const;

export function evaluateGiteaServerCapabilities(
  version: string,
): GiteaServerCapabilities {
  return {
    version,
    inlineReviewResolution: isAtLeastVersion(
      version,
      INLINE_REVIEW_RESOLUTION_MIN_VERSION,
    ),
    inlineReviewReplies: isAtLeastVersion(
      version,
      INLINE_REVIEW_REPLIES_MIN_VERSION,
    ),
  };
}

export function isAtLeastVersion(
  version: string,
  minimum: readonly [number, number, number],
): boolean {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}
