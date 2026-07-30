export const MAX_VISIBLE_OFFLINE_ITEMS = 8;
export const MAX_VISIBLE_NESTED_ITEMS = 20;
export const MAX_JSON_PREVIEW_CHARS = 12_000;

export interface BoundedOfflineCollection<T> {
  readonly items: readonly T[];
  readonly totalCount: number;
  readonly hiddenCount: number;
}

export interface PagedOfflineCollection<T> {
  readonly items: readonly T[];
  readonly totalCount: number;
  readonly matchingCount: number;
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly startNumber: number;
  readonly endNumber: number;
}

export interface SerializedJsonPreview {
  readonly fullText: string;
  readonly previewText: string;
  readonly truncated: boolean;
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

/**
 * Search runs against the complete validated artifact before page slicing.
 * This keeps every item discoverable without putting up to 5,000 rows in the
 * DOM at once.
 */
export function searchAndPageOfflineCollection<T>(
  items: readonly T[],
  query: string,
  searchableText: (item: T) => string,
  requestedPageIndex: number,
  pageSize = MAX_VISIBLE_OFFLINE_ITEMS,
): PagedOfflineCollection<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Presentation page size must be a positive integer");
  }
  const normalizedQuery = query.trim().toLowerCase();
  const matches =
    normalizedQuery.length === 0
      ? items
      : items.filter((item) =>
          searchableText(item).toLowerCase().includes(normalizedQuery),
        );
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const pageIndex = Math.min(
    Math.max(0, Number.isInteger(requestedPageIndex) ? requestedPageIndex : 0),
    pageCount - 1,
  );
  const startIndex = pageIndex * pageSize;
  const visibleItems = Object.freeze(
    matches.slice(startIndex, startIndex + pageSize),
  );

  return Object.freeze({
    items: visibleItems,
    totalCount: items.length,
    matchingCount: matches.length,
    pageIndex,
    pageCount,
    startNumber: matches.length === 0 ? 0 : startIndex + 1,
    endNumber: startIndex + visibleItems.length,
  });
}

export function serializeJsonPreview(value: unknown): SerializedJsonPreview {
  const fullText = JSON.stringify(value, null, 2) ?? "null";
  const truncated = fullText.length > MAX_JSON_PREVIEW_CHARS;
  return Object.freeze({
    fullText,
    previewText: truncated
      ? `${fullText.slice(0, MAX_JSON_PREVIEW_CHARS)}\n…`
      : fullText,
    truncated,
  });
}
