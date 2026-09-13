import type { ReviewConversation } from "./reviewConversationModel";

export type ReviewConversationPlacement =
  | {
      kind: "placed";
      side: "base" | "head";
      path: string;
      line: number;
    }
  | {
      kind: "unplaceable";
      reason: "orphaned" | "missingPath" | "missingLine" | "outdated";
    };

export function resolveReviewConversationPlacement(
  conversation: ReviewConversation,
  currentHeadSha?: string,
): ReviewConversationPlacement {
  if (conversation.orphaned) {
    return { kind: "unplaceable", reason: "orphaned" };
  }

  if (isConversationOutdated(conversation, currentHeadSha)) {
    return { kind: "unplaceable", reason: "outdated" };
  }

  const path = conversation.root.path?.trim();
  if (!path) {
    return { kind: "unplaceable", reason: "missingPath" };
  }

  const newLine = conversation.root.new_position ?? conversation.root.position ?? 0;
  if (newLine > 0) {
    return { kind: "placed", side: "head", path, line: newLine };
  }

  const oldLine =
    conversation.root.old_position ?? conversation.root.original_position ?? 0;
  if (oldLine > 0) {
    return { kind: "placed", side: "base", path, line: oldLine };
  }

  return { kind: "unplaceable", reason: "missingLine" };
}

export function isConversationOutdated(
  conversation: ReviewConversation,
  currentHeadSha?: string,
): boolean {
  if (conversation.outdated) return true;

  const current = currentHeadSha?.trim();
  if (!current) return false;

  const comments = [conversation.root, ...conversation.replies];
  const commitIds = comments
    .map((comment) => comment.commit_id?.trim())
    .filter((commitId): commitId is string => !!commitId);

  // If Gitea did not provide a commit id we cannot prove that the anchor is
  // stale, so keep the legacy placement rules. When it did provide one, any
  // comment created against another head belongs to a historical snapshot and
  // must not be projected onto a same-numbered line in the current diff.
  return commitIds.length > 0 && commitIds.every((commitId) => commitId !== current);
}
