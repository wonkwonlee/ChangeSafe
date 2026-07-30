export const MAX_VISIBLE_OFFLINE_ITEMS = 100;

export interface BoundedOfflineCollection<T> {
  readonly items: readonly T[];
  readonly totalCount: number;
  readonly hiddenCount: number;
}

/**
 * Limits DOM work for schema-valid offline artifacts that may contain up to
 * 5,000 resources. Deterministic evaluation still receives the full input.
 */
export function boundOfflineCollection<T>(
  items: readonly T[],
): BoundedOfflineCollection<T> {
  const visibleItems = Object.freeze(
    items.slice(0, MAX_VISIBLE_OFFLINE_ITEMS),
  );
  return Object.freeze({
    items: visibleItems,
    totalCount: items.length,
    hiddenCount: Math.max(0, items.length - visibleItems.length),
  });
}
