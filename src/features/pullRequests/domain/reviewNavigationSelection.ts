import type {
  ReviewNavigationCandidate,
  ReviewNavigationMode,
  ReviewNavigationModel,
} from "./reviewNavigationModel";

export function reviewNavigationItems(
  model: ReviewNavigationModel,
  mode: ReviewNavigationMode,
): ReviewNavigationCandidate[] {
  return mode === "pending" ? model.pending : model.unresolved;
}

export function nextReviewNavigationItem(
  items: readonly ReviewNavigationCandidate[],
  activeItemId: string | undefined,
  direction: 1 | -1,
): ReviewNavigationCandidate | undefined {
  if (items.length === 0) return undefined;
  const currentIndex = activeItemId
    ? items.findIndex((item) => item.id === activeItemId)
    : -1;
  if (currentIndex < 0) {
    return direction > 0 ? items[0] : items[items.length - 1];
  }
  return items[(currentIndex + direction + items.length) % items.length];
}
