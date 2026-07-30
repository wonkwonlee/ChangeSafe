import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hashCanonical } from "@changesafe/core";
import { SCENARIOS } from "../../../scenarios";
import { DurableReviewStore } from "../src/durable-review-store";

const sha = (character: string) => character.repeat(64);
const nodeRequire = createRequire(import.meta.url);
function temporaryDatabasePath(): { path: string; remove(): void } { const directory = mkdtempSync(join(tmpdir(), "changesafe-durable-review-store-")); return { path: join(directory, "reviews.sqlite"), remove: () => rmSync(directory, { recursive: true, force: true }) }; }

async function pending(reviewId: string, sourceId = "network-source") {
  const content = SCENARIOS[0]!.bundle;
  const inputSha256 = await hashCanonical(content);
  return {
    recordVersion: "2", reviewId, createdAtUtc: "2026-07-30T01:00:00.000Z",
    session: { domainId: "network", contractVersion: "2.0.0", policyVersion: "network-policy-v1", domainShape: "simulated-state", capabilities: { sandboxSimulation: true, resourceGraph: true, structuredDiff: true, untrustedContext: true, durableDecision: true }, runtimeMode: "self-hosted", source: "uploaded-offline-artifact", analysisMode: "offline", provenance: "uploaded-offline-artifact" },
    intake: { domainId: "network", source: { domainId: "network", sourceId, sourceKind: "network-incident-bundle", origin: "uploaded-offline-artifact", collectedAtUtc: "2026-07-30T00:00:00.000Z" }, input: { inputId: "network-input", inputSha256, content } },
    storage: { kind: "append-only-review-store" },
  } as const;
}
async function legacy(reviewId: string) {
  const item = await pending(reviewId);
  return { ...item, recordVersion: "1", receipt: { receiptId: `${reviewId}-receipt`, sourceId: item.intake.source.sourceId, inputId: item.intake.input.inputId, inputSha256: item.intake.input.inputSha256, proposalId: `${reviewId}-proposal`, proposalSha256: sha("b"), policyVersion: item.session.policyVersion, receiptSha256: sha("c") }, storage: { kind: "append-only-ledger" } } as const;
}
function resolution(reviewId: string, item: Awaited<ReturnType<typeof pending>>, suffix = "one") {
  return { resolutionVersion: "1", reviewId, resolvedAtUtc: "2026-07-30T02:00:00.000Z", receipt: { receiptId: `${reviewId}-receipt-${suffix}`, sourceId: item.intake.source.sourceId, inputId: item.intake.input.inputId, inputSha256: item.intake.input.inputSha256, proposalId: `${reviewId}-proposal`, proposalSha256: sha("b"), policyVersion: item.session.policyVersion, receiptSha256: sha(suffix === "one" ? "c" : "d") } } as const;
}

describe("DurableReviewStore v2 pending queue", () => {
  it("accepts a verified receipt-free pending intake exactly once", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); const first = await store.appendPending(item); expect(await store.appendPending(item)).toEqual(first); expect(first).toMatchObject({ seq: 1, reviewId: "review-one" }); expect(store.count()).toBe(1); expect(store.get("review-one")).toEqual(first); expect(store.getResolution("review-one")).toBeNull(); } finally { store.close(); }
  });

  it("rejects receipt injection and pending id collisions before insertion", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); await expect(store.appendPending({ ...item, receipt: { receiptId: "injected" } })).rejects.toThrow(); await store.appendPending(item); await expect(store.appendPending({ ...item, intake: { ...item.intake, source: { ...item.intake.source, sourceId: "other-source" } } })).rejects.toThrow(/different immutable metadata/); expect(store.count()).toBe(1); } finally { store.close(); }
  });

  it("appends one separately immutable server resolution and binds its receipt one-to-one", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const one = await pending("review-one"); const two = await pending("review-two", "other-source"); await store.appendPending(one); await store.appendPending(two);
      const bound = await store.bindServerResolution(one.reviewId, resolution(one.reviewId, one));
      expect(await store.bindServerResolution(one.reviewId, resolution(one.reviewId, one))).toEqual(bound);
      await expect(store.bindServerResolution(one.reviewId, resolution(one.reviewId, one, "two"))).rejects.toThrow(/different immutable resolution/);
      const conflicting = resolution(two.reviewId, two);
      await expect(store.bindServerResolution(two.reviewId, { ...conflicting, receipt: { ...conflicting.receipt, receiptId: bound.receiptId, receiptSha256: bound.receiptSha256 } })).rejects.toThrow(/already bound to review review-one/);
      expect(store.get("review-one")?.record).toEqual(one);
      expect(store.getResolution("review-one")?.resolution).toEqual(resolution(one.reviewId, one));
    } finally { store.close(); }
  });

  it("requires an existing pending review and refuses a resolution whose receipt is not server-bound to it", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); await expect(store.bindServerResolution(item.reviewId, resolution(item.reviewId, item))).rejects.toThrow(/No pending/); await store.appendPending(item); const forged = resolution(item.reviewId, item); await expect(store.bindServerResolution(item.reviewId, { ...forged, receipt: { ...forged.receipt, inputId: "other-input" } })).rejects.toThrow(/does not match/); } finally { store.close(); }
  });

  it("does not let raw INSERT OR REPLACE replace pending or resolution rows with recursive triggers off", async () => {
    const database = temporaryDatabasePath(); const store = DurableReviewStore.open(database.path);
    try {
      const item = await pending("review-one"); await store.appendPending(item); const bound = await store.bindServerResolution(item.reviewId, resolution(item.reviewId, item));
      const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const raw = new sqlite.DatabaseSync(database.path);
      try {
        raw.exec("PRAGMA recursive_triggers = OFF");
        expect(() => raw.prepare("INSERT OR REPLACE INTO durable_review_pending_records (seq, review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(1, "new-review", item.createdAtUtc, "network", "new-source", "new-input", JSON.stringify(item))).toThrow(/append-only/);
        expect(() => raw.prepare("INSERT OR REPLACE INTO durable_review_resolutions (seq, review_id, resolved_at_utc, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?)").run(1, "new-review", bound.resolvedAtUtc, "new-receipt", sha("e"), JSON.stringify(bound.resolution))).toThrow(/append-only/);
      } finally { raw.close(); }
      expect(store.get(item.reviewId)?.record).toEqual(item); expect(store.getResolution(item.reviewId)).toEqual(bound);
    } finally { store.close(); database.remove(); }
  });

  it("preserves legacy v1 resolved rows on upgrade without presenting them as pending v2 queue work", async () => {
    const database = temporaryDatabasePath(); const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const old = await legacy("old-review");
    const raw = new sqlite.DatabaseSync(database.path);
    try { raw.exec("CREATE TABLE durable_review_records (seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL, domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL)"); raw.prepare("INSERT INTO durable_review_records (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(old.reviewId, old.createdAtUtc, old.intake.domainId, old.intake.source.sourceId, old.intake.input.inputId, old.receipt.receiptId, old.receipt.receiptSha256, JSON.stringify(old)); } finally { raw.close(); }
    const store = DurableReviewStore.open(database.path);
    try { expect(store.count()).toBe(0); expect(store.get("old-review")).toBeNull(); expect(store.legacyCount()).toBe(1); expect(store.getLegacy("old-review")?.record).toEqual(old); const next = await pending("new-review"); await store.appendPending(next); expect(store.list().map((entry) => entry.reviewId)).toEqual(["new-review"]); expect(store.listLegacy().map((entry) => entry.reviewId)).toEqual(["old-review"]); } finally { store.close(); database.remove(); }
  });

  it("keeps compatibility-only v1 append isolated from the pending queue", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const old = await legacy("legacy-review"); await store.append(old); expect(store.legacyCount()).toBe(1); expect(store.count()).toBe(0); expect(store.get("legacy-review")).toBeNull(); expect(store.getLegacy("legacy-review")?.record).toEqual(old); } finally { store.close(); }
  });
});
