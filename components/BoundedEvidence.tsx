"use client";

import { useMemo, useState } from "react";

import {
  serializeJsonPreview,
  type PagedOfflineCollection,
} from "@/features/domains/presentation-limit";

interface EvidencePagerProps {
  readonly id: string;
  readonly label: string;
  readonly noun: string;
  readonly query: string;
  readonly page: PagedOfflineCollection<unknown>;
  readonly onQueryChange: (query: string) => void;
  readonly onPageChange: (pageIndex: number) => void;
}

export function EvidencePager({
  id,
  label,
  noun,
  query,
  page,
  onQueryChange,
  onPageChange,
}: EvidencePagerProps) {
  const hasFilter = query.trim().length > 0;
  const count = hasFilter
    ? `Showing ${page.startNumber}–${page.endNumber} of ${page.matchingCount} matching ${noun} from ${page.totalCount} total.`
    : `Showing ${page.startNumber}–${page.endNumber} of ${page.totalCount} ${noun}.`;

  return (
    <div className="mt-3 grid gap-3">
      <label className="grid gap-1 text-xs text-ink-dim" htmlFor={id}>
        <span>{label}</span>
        <input
          className="rounded border border-edge bg-canvas px-3 py-2 text-sm text-ink"
          id={id}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          type="search"
          value={query}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-faint">
        <p aria-live="polite">{count}</p>
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-edge px-3 py-1.5 text-ink disabled:opacity-50"
            disabled={page.pageIndex === 0}
            onClick={() => onPageChange(page.pageIndex - 1)}
            type="button"
          >
            Previous
          </button>
          <span>
            Page {page.pageIndex + 1} of {page.pageCount}
          </span>
          <button
            className="rounded border border-edge px-3 py-1.5 text-ink disabled:opacity-50"
            disabled={page.pageIndex + 1 >= page.pageCount}
            onClick={() => onPageChange(page.pageIndex + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export function BoundedJsonBlock({
  label,
  value,
}: {
  readonly label: string;
  readonly value: unknown;
}) {
  const serialized = useMemo(() => serializeJsonPreview(value), [value]);
  const [expanded, setExpanded] = useState(false);
  const visibleText = expanded ? serialized.fullText : serialized.previewText;

  return (
    <div>
      <pre
        aria-label={label}
        className="mt-3 max-h-72 overflow-auto rounded border border-edge bg-canvas p-3 text-xs leading-relaxed text-ink-dim"
      >
        {visibleText}
      </pre>
      {serialized.truncated ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <p>
            {expanded
              ? `Showing all ${serialized.fullText.length} characters.`
              : `Previewing 12,000 of ${serialized.fullText.length} characters.`}
          </p>
          <button
            aria-expanded={expanded}
            className="rounded border border-edge px-3 py-1.5 text-ink"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? `Collapse ${label}` : `Show complete ${label}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
