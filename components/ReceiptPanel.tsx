"use client";

import type { ChangeReceipt } from "@changesafe/core";
import { IdChip } from "./atoms";

function downloadReceipt(receipt: ChangeReceipt) {
  const blob = new Blob([`${JSON.stringify(receipt, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `changesafe-receipt-${receipt.receiptId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const FIELD_LABELS: [keyof ChangeReceipt, string][] = [
  ["receiptId", "Receipt"],
  ["inputId", "Incident"],
  ["proposalId", "Proposal"],
  ["sourceId", "Scenario"],
  ["createdAtUtc", "Created (UTC)"],
  ["appVersion", "App version"],
  ["policyVersion", "Policy version"],
];

export function ReceiptPanel({ receipt }: { receipt: ChangeReceipt }) {
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
        <p className="text-[13px] text-ink-dim">
          Signed record of this decision — canonical JSON hashed with SHA-256.
        </p>
        <button
          type="button"
          onClick={() => downloadReceipt(receipt)}
          className="ml-auto rounded border border-active bg-active/15 px-4 py-2 text-[13px] font-medium text-active hover:bg-active/25"
        >
          Download receipt JSON
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 px-4 py-4 sm:grid-cols-2">
        {FIELD_LABELS.map(([key, label]) => (
          <div key={key} className="flex items-baseline justify-between gap-3 sm:justify-start">
            <dt className="eyebrow shrink-0 text-ink-faint">{label}</dt>
            <dd className="break-all font-mono text-[12px] text-ink-dim">{String(receipt[key])}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 sm:justify-start">
          <dt className="eyebrow shrink-0 text-ink-faint">Mode</dt>
          <dd className="font-mono text-[12px] text-ink-dim">
            {receipt.mode}
            {receipt.fixtureProvenance ? ` (${receipt.fixtureProvenance})` : ""}
            {receipt.model ? ` · ${receipt.model}` : ""}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:justify-start">
          <dt className="eyebrow shrink-0 text-ink-faint">Decision / risk</dt>
          <dd className="font-mono text-[12px] text-ink-dim">
            {receipt.decision} · {receipt.riskLevel}
          </dd>
        </div>
      </dl>
      <div className="space-y-2 border-t border-edge px-4 py-4">
        <p className="eyebrow text-ink-faint">Hashes (SHA-256, canonical serialization)</p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="eyebrow w-20 shrink-0 text-ink-faint">incident</span>
          <IdChip value={receipt.inputSha256} />
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="eyebrow w-20 shrink-0 text-ink-faint">proposal</span>
          <IdChip value={receipt.proposalSha256} />
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="eyebrow w-20 shrink-0 text-ink-faint">receipt</span>
          <IdChip value={receipt.receiptSha256} />
        </p>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          The receipt hash covers every field above except itself. Recompute it from the
          downloaded JSON to verify integrity.
        </p>
      </div>
    </div>
  );
}
