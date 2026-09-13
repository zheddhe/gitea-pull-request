import type { ReviewConversation } from "./reviewConversationModel";

export interface ReviewConversationDisplayGroups {
  outdated: ReviewConversation[];
  unplaced: ReviewConversation[];
}

/**
 * Split conversations that cannot be rendered inline in the current PR diff.
 *
 * Outdated is a first-class historical state: it says the conversation belongs
 * to an earlier revision, independently from whether the conversation is
 * resolved. Other unplaced conversations represent projection failures such as
 * missing/orphaned anchors and are kept separate so PR Detail can explain the
 * difference to the reviewer.
 */
export function groupUnplacedReviewConversations(
  conversations: ReviewConversation[],
  matchedCommentIds: ReadonlySet<number>,
): ReviewConversationDisplayGroups {
  const notMatched = conversations.filter((conversation) =>
    [conversation.root.id, ...conversation.replies.map((reply) => reply.id)].every(
      (id) => !matchedCommentIds.has(id),
    ),
  );

  return {
    outdated: notMatched.filter((conversation) => conversation.outdated === true),
    unplaced: notMatched.filter((conversation) => conversation.outdated !== true),
  };
}
