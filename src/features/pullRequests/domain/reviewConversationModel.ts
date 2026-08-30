import type {
  GiteaReviewComment,
  GiteaUser,
} from "../../../api/types";

export interface ReviewConversation {
  root: GiteaReviewComment;
  replies: GiteaReviewComment[];
  resolved: boolean;
  resolver?: GiteaUser;
  orphaned: boolean;
}

export function buildReviewConversations(
  comments: GiteaReviewComment[],
): ReviewConversation[] {
  const sorted = [...comments].sort(byCreatedAt);
  const byId = new Map(sorted.map((comment) => [comment.id, comment]));
  const groups = new Map<string, GiteaReviewComment[]>();
  const orphanReplies: GiteaReviewComment[] = [];

  for (const comment of sorted) {
    const explicitRoot = resolveExplicitRoot(comment, byId);
    if (comment.in_reply_to_id && !explicitRoot) {
      orphanReplies.push(comment);
      continue;
    }

    const anchor = conversationAnchor(explicitRoot ?? comment);
    const key = explicitRoot
      ? `root:${explicitRoot.id}`
      : anchor
        ? `anchor:${anchor}`
        : `comment:${comment.id}`;
    groups.set(key, [...(groups.get(key) ?? []), comment]);
  }

  // Gitea's web UI defines a review conversation by code location
  // (tree path + signed line), not by a persisted parent/child relation. A
  // reply created through the 1.27 API is added to the same review/line and
  // may therefore be returned without in_reply_to_id. Merge explicit-root
  // groups back into the canonical anchor group when possible.
  for (const [key, group] of [...groups.entries()]) {
    if (!key.startsWith("root:")) continue;
    const anchor = conversationAnchor(group[0]);
    if (!anchor) continue;
    const anchorKey = `anchor:${anchor}`;
    const existing = groups.get(anchorKey);
    if (!existing) {
      groups.set(anchorKey, group);
    } else {
      groups.set(anchorKey, [...existing, ...group].sort(byCreatedAt));
    }
    groups.delete(key);
  }

  const conversations = [...groups.values()].map(toConversation);

  for (const orphan of orphanReplies) {
    conversations.push({
      root: orphan,
      replies: [],
      resolved: !!orphan.resolver,
      resolver: orphan.resolver,
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

function toConversation(group: GiteaReviewComment[]): ReviewConversation {
  const ordered = [...group].sort(byCreatedAt);
  const root = ordered[0];
  const resolver = ordered.find((comment) => comment.resolver)?.resolver;
  return {
    root,
    replies: ordered.slice(1),
    resolved: !!resolver,
    resolver,
    orphaned: false,
  };
}

function resolveExplicitRoot(
  comment: GiteaReviewComment,
  byId: Map<number, GiteaReviewComment>,
): GiteaReviewComment | undefined {
  if (!comment.in_reply_to_id) return undefined;
  let current = byId.get(comment.in_reply_to_id);
  if (!current) return undefined;

  const seen = new Set<number>([comment.id]);
  while (current.in_reply_to_id && byId.has(current.in_reply_to_id)) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    current = byId.get(current.in_reply_to_id)!;
  }
  return current;
}

function conversationAnchor(comment: GiteaReviewComment): string | undefined {
  const newLine = comment.new_position ?? comment.position ?? 0;
  const oldLine = comment.old_position ?? comment.original_position ?? 0;
  if (newLine > 0) return `${comment.path}:new:${newLine}`;
  if (oldLine > 0) return `${comment.path}:old:${oldLine}`;
  return undefined;
}

function byCreatedAt(
  left: GiteaReviewComment,
  right: GiteaReviewComment,
): number {
  return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
}
