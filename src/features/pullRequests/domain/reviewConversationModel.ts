import type { GiteaReviewComment } from "../../../api/types";

export interface ReviewConversation {
  root: GiteaReviewComment;
  replies: GiteaReviewComment[];
  resolved: boolean;
  orphaned: boolean;
}

export function buildReviewConversations(
  comments: GiteaReviewComment[],
): ReviewConversation[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const repliesByRoot = new Map<number, GiteaReviewComment[]>();
  const roots: GiteaReviewComment[] = [];
  const orphanReplies: GiteaReviewComment[] = [];

  for (const comment of comments) {
    const parentId = comment.in_reply_to_id;
    if (!parentId) {
      roots.push(comment);
      continue;
    }

    const parent = byId.get(parentId);
    if (!parent) {
      orphanReplies.push(comment);
      continue;
    }

    // The API targets the top-level comment for replies. Be defensive if an
    // instance returns a reply-to-reply relation and walk to the root.
    let root = parent;
    const seen = new Set<number>([comment.id]);
    while (root.in_reply_to_id && byId.has(root.in_reply_to_id)) {
      if (seen.has(root.id)) break;
      seen.add(root.id);
      root = byId.get(root.in_reply_to_id)!;
    }
    repliesByRoot.set(root.id, [
      ...(repliesByRoot.get(root.id) ?? []),
      comment,
    ]);
  }

  const conversations: ReviewConversation[] = roots.map((root) => ({
    root,
    replies: (repliesByRoot.get(root.id) ?? []).sort(byCreatedAt),
    resolved: !!root.resolver,
    orphaned: false,
  }));

  for (const orphan of orphanReplies) {
    conversations.push({
      root: orphan,
      replies: [],
      resolved: !!orphan.resolver,
      orphaned: true,
    });
  }

  return conversations.sort((left, right) => byCreatedAt(left.root, right.root));
}

export function conversationCommentIds(
  conversation: ReviewConversation,
): number[] {
  return [conversation.root.id, ...conversation.replies.map((reply) => reply.id)];
}

function byCreatedAt(
  left: GiteaReviewComment,
  right: GiteaReviewComment,
): number {
  return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
}
