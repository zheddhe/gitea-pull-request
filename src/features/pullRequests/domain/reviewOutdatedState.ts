import type { ReviewConversation } from "./reviewConversationModel";

/**
 * Outdated and resolved are intentionally orthogonal. A historical anchor can
 * become invalid after the PR head moves without changing whether a reviewer
 * explicitly resolved the conversation.
 */
export function markOutdatedReviewConversations(
  conversations: ReviewConversation[],
  currentHeadSha: string,
): ReviewConversation[] {
  const head = currentHeadSha.trim();
  return conversations.map((conversation) => {
    const commitIds = [conversation.root, ...conversation.replies]
      .map((comment) => comment.commit_id?.trim())
      .filter((commitId): commitId is string => !!commitId);
    return {
      ...conversation,
      outdated:
        head.length > 0 &&
        commitIds.length > 0 &&
        commitIds.every((commitId) => commitId !== head),
    };
  });
}
