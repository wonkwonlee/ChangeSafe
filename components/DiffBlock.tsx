"use client";

import { useMemo } from "react";

import { BoundedJsonBlock } from "@/components/BoundedEvidence";
import {
  MAX_LEAF_CHANGES,
  computeLineDiff,
  formatLeafChange,
  summarizeLeafChanges,
  type DiffLine,
} from "@/components/diffLines";
import { serializeJsonPreview } from "@/features/domains/presentation-limit";

const LINE_TONE_CLASSNAME: Record<DiffLine["type"], string> = {
  context: "text-ink-dim",
  add: "bg-pass/10 text-pass",
  remove: "bg-block/10 text-block",
};

const LINE_MARKER: Record<DiffLine["type"], string> = {
  context: " ",
  add: "+",
  remove: "-",
};

const LINE_SR_LABEL: Record<DiffLine["type"], string | null> = {
  context: null,
  add: "added: ",
  remove: "removed: ",
};

/**
 * A real before/after diff, not two side-by-side JSON dumps. The +/- marker
 * carries the meaning for sighted readers who can't rely on color alone; a
 * paired sr-only "added"/"removed" word carries the same distinction for
 * screen readers, since the glyph itself is decorative to them. Falls back
 * to plain before/after blocks when the
 * value is too large to diff cheaply (see `computeLineDiff`).
 */
export function DiffBlock({
  label,
  before,
  after,
}: {
  readonly label: string;
  readonly before: unknown;
  readonly after: unknown;
}) {
  const leafChanges = useMemo(() => summarizeLeafChanges(before, after), [before, after]);
  // A root-level replacement (the whole value added, removed, or swapped for
  // a different type) collapses to one "(root): {huge JSON} → …" entry that
  // is harder to read than the line diff already below it — so the one-line
  // summary is only worth showing for a genuine field-level diff.
  const isRootReplacement = leafChanges.some((change) => change.path === "(root)");
  const summary = isRootReplacement ? [] : leafChanges;
  const diffLines = useMemo(() => {
    const beforeText = serializeJsonPreview(before).fullText;
    const afterText = serializeJsonPreview(after).fullText;
    return computeLineDiff(beforeText, afterText);
  }, [before, after]);

  return (
    <div className="min-w-0">
      {summary.length > 0 ? (
        <p className="mt-2 text-xs text-ink-dim">
          {summary.map(formatLeafChange).join(" · ")}
          {summary.length >= MAX_LEAF_CHANGES ? " · …" : ""}
        </p>
      ) : leafChanges.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">No leaf value differs between current and proposed.</p>
      ) : null}
      {diffLines ? (
        <pre
          aria-label={`${label} diff`}
          className="mt-2 max-h-96 overflow-auto rounded border border-edge bg-canvas p-3 text-xs leading-relaxed"
        >
          {diffLines.map((line, index) => (
            <div className={LINE_TONE_CLASSNAME[line.type]} key={index}>
              {LINE_SR_LABEL[line.type] ? <span className="sr-only">{LINE_SR_LABEL[line.type]}</span> : null}
              <span aria-hidden={line.type === "context" ? undefined : "true"}>{LINE_MARKER[line.type]}</span> {line.text}
            </div>
          ))}
        </pre>
      ) : (
        <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
          <BoundedJsonBlock label={`${label} before JSON`} value={before} />
          <BoundedJsonBlock label={`${label} after JSON`} value={after} />
        </div>
      )}
    </div>
  );
}
