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
      reason: "orphaned" | "missingPath" | "missingLine";
    };

export function resolveReviewConversationPlacement(
  conversation: ReviewConversation,
): ReviewConversationPlacement {
  if (conversation.orphaned) {
    return { kind: "unplaceable", reason: "orphaned" };
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
