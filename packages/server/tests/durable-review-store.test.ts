import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hashCanonical } from "@changesafe/core";
import { SCENARIOS } from "../../../scenarios";
import { DurableReviewStore } from "../src/durable-review-store";

const sha = (character: string) => character.repeat(64);
const aliceOwner = { tenantId: "https://idp.test", issuer: "https://idp.test", subject: "user-alice", scope: "self-hosted-review" } as const;
const bobOwner = { ...aliceOwner, subject: "user-bob" } as const;
const nodeRequire = createRequire(import.meta.url);
function temporaryDatabasePath(): { path: string; remove(): void } { const directory = mkdtempSync(join(tmpdir(), "changesafe-durable-review-store-")); return { path: join(directory, "reviews.sqlite"), remove: () => rmSync(directory, { recursive: true, force: true }) }; }

async function pending(
  reviewId: string,
  sourceId = "network-source",
  owner: typeof aliceOwner | typeof bobOwner = aliceOwner,
  createdAtUtc = "2026-07-30T01:00:00.000Z",
) {
  const content = SCENARIOS[0]!.bundle;
  const inputSha256 = await hashCanonical(content);
  return {
    recordVersion: "2", reviewId, createdAtUtc, owner,
    session: { domainId: "network", contractVersion: "2.0.0", policyVersion: "network-policy-v1", domainShape: "simulated-state", capabilities: { sandboxSimulation: true, resourceGraph: true, structuredDiff: true, untrustedContext: true, durableDecision: true }, runtimeMode: "self-hosted", source: "uploaded-offline-artifact", analysisMode: "offline", provenance: "uploaded-offline-artifact" },
    intake: { domainId: "network", source: { domainId: "network", sourceId, sourceKind: "network-incident-bundle", origin: "uploaded-offline-artifact", untrustedArtifactObservedAtUtc: "2026-07-30T00:00:00.000Z" }, input: { inputId: "network-input", inputSha256, content } },
    storage: { kind: "append-only-review-store" },
  } as const;
}
async function legacy(reviewId: string) {
  const item = await pending(reviewId);
  const { owner: _owner, ...withoutOwner } = item;
  void _owner;
  const { untrustedArtifactObservedAtUtc, ...historicalSource } = item.intake.source;
  return {
    ...withoutOwner,
    recordVersion: "1",
    intake: {
      ...item.intake,
      source: { ...historicalSource, collectedAtUtc: untrustedArtifactObservedAtUtc },
    },
    receipt: { receiptId: `${reviewId}-receipt`, sourceId: item.intake.source.sourceId, inputId: item.intake.input.inputId, inputSha256: item.intake.input.inputSha256, proposalId: `${reviewId}-proposal`, proposalSha256: sha("b"), policyVersion: item.session.policyVersion, receiptSha256: sha("c") },
    storage: { kind: "append-only-ledger" },
  } as const;
}
function resolution(reviewId: string, item: Awaited<ReturnType<typeof pending>>, suffix = "one") {
  return { resolutionVersion: "1", reviewId, resolvedAtUtc: "2026-07-30T02:00:00.000Z", receipt: { receiptId: `${reviewId}-receipt-${suffix}`, sourceId: item.intake.source.sourceId, inputId: item.intake.input.inputId, inputSha256: item.intake.input.inputSha256, proposalId: `${reviewId}-proposal`, proposalSha256: sha("b"), policyVersion: item.session.policyVersion, receiptSha256: sha(suffix === "one" ? "c" : "d") } } as const;
}

describe("DurableReviewStore v2 pending queue", () => {
  it("accepts a verified receipt-free pending intake exactly once", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); const first = await store.appendPending(item); expect(await store.appendPending(item)).toEqual(first); expect(first).toMatchObject({ seq: 1, reviewId: "review-one" }); expect(store.count()).toBe(1); expect(store.get("review-one", aliceOwner)).toEqual(first); expect(store.getResolution("review-one", aliceOwner)).toBeNull(); } finally { store.close(); }
  });

  it("treats advancing server timestamps as one concurrent retry and preserves first acceptance time", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const first = await pending("review-retry", "network-source", aliceOwner, "2026-07-30T01:00:00.000Z");
      const retry = await pending("review-retry", "network-source", aliceOwner, "2026-07-30T01:00:01.000Z");
      const [one, two] = await Promise.all([store.appendPending(first), store.appendPending(retry)]);
      expect(one).toEqual(two);
      expect(one.createdAtUtc).toBe("2026-07-30T01:00:00.000Z");
      expect(one.record.createdAtUtc).toBe("2026-07-30T01:00:00.000Z");
      expect(store.count()).toBe(1);
    } finally { store.close(); }
  });

  it("uses owner plus client review id as the storage identity without an existence oracle", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const alice = await pending("shared-review-id", "alice-source", aliceOwner);
      const bob = await pending("shared-review-id", "bob-source", bobOwner);
      await expect(Promise.all([store.appendPending(alice), store.appendPending(bob)])).resolves.toHaveLength(2);
      expect(store.count()).toBe(2);
      expect(store.get("shared-review-id", aliceOwner)?.record.intake.source.sourceId).toBe("alice-source");
      expect(store.get("shared-review-id", bobOwner)?.record.intake.source.sourceId).toBe("bob-source");
      expect(store.list({}, aliceOwner).map((entry) => entry.sourceId)).toEqual(["alice-source"]);
      expect(store.list({}, bobOwner).map((entry) => entry.sourceId)).toEqual(["bob-source"]);
    } finally { store.close(); }
  });

  it("filters and limits by owner in SQL before parsing any unowned row", async () => {
    const database = temporaryDatabasePath();
    const store = DurableReviewStore.open(database.path);
    try {
      const alice = await pending("alice-review", "alice-source", aliceOwner);
      await store.appendPending(alice);
      const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
      const raw = new sqlite.DatabaseSync(database.path);
      try {
        raw.prepare("INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, owner_tenant_id, owner_issuer, owner_subject, owner_scope, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          "bob-corrupt-review",
          "2026-07-30T01:00:01.000Z",
          "network",
          "bob-source",
          "network-input",
          ...Object.values(bobOwner),
          "{not-valid-json",
        );
      } finally { raw.close(); }

      expect(store.list({ limit: 1 }, aliceOwner).map((entry) => entry.reviewId)).toEqual(["alice-review"]);
      expect(() => store.list({ limit: 1 }, bobOwner)).toThrow();
    } finally { store.close(); database.remove(); }
  });

  it("rejects receipt injection and pending id collisions before insertion", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); await expect(store.appendPending({ ...item, receipt: { receiptId: "injected" } })).rejects.toThrow(); await store.appendPending(item); await expect(store.appendPending({ ...item, intake: { ...item.intake, source: { ...item.intake.source, sourceId: "other-source" } } })).rejects.toThrow(/different immutable metadata/); expect(store.count()).toBe(1); } finally { store.close(); }
  });

  it("appends one separately immutable server resolution and binds its receipt one-to-one", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const one = await pending("review-one"); const two = await pending("review-two", "other-source"); await store.appendPending(one); await store.appendPending(two);
      const bound = await store.bindServerResolution(one.reviewId, aliceOwner, resolution(one.reviewId, one));
      expect(await store.bindServerResolution(one.reviewId, aliceOwner, resolution(one.reviewId, one))).toEqual(bound);
      await expect(store.bindServerResolution(one.reviewId, aliceOwner, resolution(one.reviewId, one, "two"))).rejects.toThrow(/different immutable resolution/);
      const conflicting = resolution(two.reviewId, two);
      await expect(store.bindServerResolution(two.reviewId, aliceOwner, { ...conflicting, receipt: { ...conflicting.receipt, receiptId: bound.receiptId, receiptSha256: bound.receiptSha256 } })).rejects.toThrow(/already bound to review review-one/);
      expect(store.get("review-one", aliceOwner)?.record).toEqual(one);
      expect(store.getResolution("review-one", aliceOwner)?.resolution).toEqual(resolution(one.reviewId, one));
    } finally { store.close(); }
  });

  it("requires an existing pending review and refuses a resolution whose receipt is not server-bound to it", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); await expect(store.bindServerResolution(item.reviewId, aliceOwner, resolution(item.reviewId, item))).rejects.toThrow(/No pending/); await store.appendPending(item); const forged = resolution(item.reviewId, item); await expect(store.bindServerResolution(item.reviewId, aliceOwner, { ...forged, receipt: { ...forged.receipt, inputId: "other-input" } })).rejects.toThrow(/does not match/); } finally { store.close(); }
  });

  it("requires owner scope for resolution reads and writes", async () => {
    const store = DurableReviewStore.open(":memory:");
    try {
      const item = await pending("review-owner-resolution");
      await store.appendPending(item);
      await expect(store.bindServerResolution(item.reviewId, bobOwner, resolution(item.reviewId, item))).rejects.toThrow(/No pending/);
      expect(store.getResolution(item.reviewId, bobOwner)).toBeNull();
      const bound = await store.bindServerResolution(item.reviewId, aliceOwner, resolution(item.reviewId, item));
      expect(store.getResolution(item.reviewId, bobOwner)).toBeNull();
      expect(store.getResolution(item.reviewId, aliceOwner)).toEqual(bound);
    } finally { store.close(); }
  });

  it("does not let raw INSERT OR REPLACE replace pending or resolution rows with recursive triggers off", async () => {
    const database = temporaryDatabasePath(); const store = DurableReviewStore.open(database.path);
    try {
      const item = await pending("review-one"); await store.appendPending(item); const bound = await store.bindServerResolution(item.reviewId, aliceOwner, resolution(item.reviewId, item));
      const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const raw = new sqlite.DatabaseSync(database.path);
      try {
        raw.exec("PRAGMA recursive_triggers = OFF");
        expect(() => raw.prepare("INSERT OR REPLACE INTO durable_review_pending_records (seq, review_id, created_at_utc, domain_id, source_id, input_id, owner_tenant_id, owner_issuer, owner_subject, owner_scope, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, "new-review", item.createdAtUtc, "network", "new-source", "new-input", ...Object.values(aliceOwner), JSON.stringify(item))).toThrow(/append-only/);
        expect(() => raw.prepare("INSERT OR REPLACE INTO durable_review_resolutions (seq, review_id, resolved_at_utc, owner_tenant_id, owner_issuer, owner_subject, owner_scope, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(1, "new-review", bound.resolvedAtUtc, ...Object.values(aliceOwner), "new-receipt", sha("e"), JSON.stringify(bound.resolution))).toThrow(/append-only|immutable parent binding/);
      } finally { raw.close(); }
      expect(store.get(item.reviewId, aliceOwner)?.record).toEqual(item); expect(store.getResolution(item.reviewId, aliceOwner)).toEqual(bound);
    } finally { store.close(); database.remove(); }
  });

  it("rejects raw resolution rows without an exactly-bound pending intake when foreign keys are off", async () => {
    const database = temporaryDatabasePath(); const store = DurableReviewStore.open(database.path);
    try {
      const item = await pending("review-one"); await store.appendPending(item);
      const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const raw = new sqlite.DatabaseSync(database.path);
      try {
        raw.exec("PRAGMA foreign_keys = OFF");
        const insert = raw.prepare("INSERT INTO durable_review_resolutions (review_id, resolved_at_utc, owner_tenant_id, owner_issuer, owner_subject, owner_scope, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        const orphan = resolution("orphan-review", item);
        expect(() => insert.run(orphan.reviewId, orphan.resolvedAtUtc, ...Object.values(aliceOwner), orphan.receipt.receiptId, orphan.receipt.receiptSha256, JSON.stringify(orphan))).toThrow(/immutable parent binding/);
        const mismatch = resolution(item.reviewId, item);
        const forged = { ...mismatch, receipt: { ...mismatch.receipt, inputId: "other-input" } };
        expect(() => insert.run(forged.reviewId, forged.resolvedAtUtc, ...Object.values(aliceOwner), forged.receipt.receiptId, forged.receipt.receiptSha256, JSON.stringify(forged))).toThrow(/immutable parent binding/);
      } finally { raw.close(); }
      expect(store.getResolution(item.reviewId, aliceOwner)).toBeNull();
    } finally { store.close(); database.remove(); }
  });

  it("upgrades the prior ownerless v2 schema without inventing ownership or losing bound rows", async () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const owned = await pending("owned-old-review");
    const ownedResolution = resolution(owned.reviewId, owned);
    const ownerless = await pending("unowned-old-review", "unowned-source");
    const { owner: _discardedOwner, ...unownedRecord } = ownerless;
    void _discardedOwner;
    const unownedResolution = resolution(ownerless.reviewId, ownerless, "two");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      raw.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE durable_review_records (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL,
          domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL,
          receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL
        );
        CREATE TABLE durable_review_pending_records (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL,
          domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL, record_json TEXT NOT NULL
        );
        CREATE TABLE durable_review_resolutions (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, resolved_at_utc TEXT NOT NULL,
          receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, resolution_json TEXT NOT NULL,
          FOREIGN KEY (review_id) REFERENCES durable_review_pending_records(review_id)
        );
        CREATE INDEX durable_review_pending_records_created ON durable_review_pending_records (created_at_utc);
        CREATE INDEX durable_review_pending_records_domain ON durable_review_pending_records (domain_id);
        CREATE INDEX durable_review_pending_records_source ON durable_review_pending_records (source_id);
        CREATE TRIGGER durable_review_pending_records_no_update BEFORE UPDATE ON durable_review_pending_records
          BEGIN SELECT RAISE(ABORT, 'durable_review_pending_records is append-only: rows cannot be updated'); END;
        CREATE TRIGGER durable_review_pending_records_no_delete BEFORE DELETE ON durable_review_pending_records
          BEGIN SELECT RAISE(ABORT, 'durable_review_pending_records is append-only: rows cannot be deleted'); END;
        CREATE TRIGGER durable_review_pending_records_no_conflicting_insert BEFORE INSERT ON durable_review_pending_records
          WHEN EXISTS (SELECT 1 FROM durable_review_pending_records WHERE review_id = NEW.review_id OR (NEW.seq > 0 AND seq = NEW.seq))
          BEGIN SELECT RAISE(ABORT, 'durable_review_pending_records is append-only: existing bindings cannot be replaced'); END;
        CREATE TRIGGER durable_review_resolutions_no_update BEFORE UPDATE ON durable_review_resolutions
          BEGIN SELECT RAISE(ABORT, 'durable_review_resolutions is append-only: rows cannot be updated'); END;
        CREATE TRIGGER durable_review_resolutions_no_delete BEFORE DELETE ON durable_review_resolutions
          BEGIN SELECT RAISE(ABORT, 'durable_review_resolutions is append-only: rows cannot be deleted'); END;
        CREATE TRIGGER durable_review_resolutions_no_conflicting_insert BEFORE INSERT ON durable_review_resolutions
          WHEN EXISTS (SELECT 1 FROM durable_review_resolutions WHERE review_id = NEW.review_id OR receipt_id = NEW.receipt_id OR receipt_sha256 = NEW.receipt_sha256 OR (NEW.seq > 0 AND seq = NEW.seq))
          BEGIN SELECT RAISE(ABORT, 'durable_review_resolutions is append-only: existing bindings cannot be replaced'); END;
        CREATE TRIGGER durable_review_resolutions_parent_binding BEFORE INSERT ON durable_review_resolutions
          WHEN NOT EXISTS (SELECT 1 FROM durable_review_pending_records WHERE review_id = NEW.review_id)
          BEGIN SELECT RAISE(ABORT, 'durable_review_resolutions requires immutable parent binding'); END;
      `);
      const insertPending = raw.prepare(
        "INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insertPending.run(
        owned.reviewId,
        owned.createdAtUtc,
        owned.intake.domainId,
        owned.intake.source.sourceId,
        owned.intake.input.inputId,
        JSON.stringify(owned),
      );
      insertPending.run(
        unownedRecord.reviewId,
        unownedRecord.createdAtUtc,
        unownedRecord.intake.domainId,
        unownedRecord.intake.source.sourceId,
        unownedRecord.intake.input.inputId,
        JSON.stringify(unownedRecord),
      );
      const insertResolution = raw.prepare(
        "INSERT INTO durable_review_resolutions (review_id, resolved_at_utc, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?)",
      );
      insertResolution.run(
        ownedResolution.reviewId,
        ownedResolution.resolvedAtUtc,
        ownedResolution.receipt.receiptId,
        ownedResolution.receipt.receiptSha256,
        JSON.stringify(ownedResolution),
      );
      insertResolution.run(
        unownedResolution.reviewId,
        unownedResolution.resolvedAtUtc,
        unownedResolution.receipt.receiptId,
        unownedResolution.receipt.receiptSha256,
        JSON.stringify(unownedResolution),
      );
    } finally {
      raw.close();
    }

    const store = DurableReviewStore.open(database.path);
    try {
      expect(store.count()).toBe(1);
      expect(store.get(owned.reviewId, aliceOwner)?.record).toEqual(owned);
      expect(store.get(owned.reviewId, bobOwner)).toBeNull();
      expect(store.getResolution(owned.reviewId, aliceOwner)?.resolution).toEqual(ownedResolution);
      expect(store.getResolution(owned.reviewId, bobOwner)).toBeNull();
      expect(store.get(ownerless.reviewId, aliceOwner)).toBeNull();

      const migrated = new sqlite.DatabaseSync(database.path);
      try {
        const quarantine = migrated
          .prepare("SELECT row_kind, review_id, reason, row_json FROM durable_review_v2_migration_quarantine ORDER BY row_kind")
          .all() as Array<{ row_kind: string; review_id: string; reason: string; row_json: string }>;
        expect(quarantine.map(({ row_kind, review_id, reason }) => ({ row_kind, review_id, reason }))).toEqual([
          {
            row_kind: "pending",
            review_id: ownerless.reviewId,
            reason: "pending-record-invalid-or-ownerless",
          },
          {
            row_kind: "resolution",
            review_id: ownerless.reviewId,
            reason: "resolution-parent-unmigrated",
          },
        ]);
        expect(quarantine.every((row) => JSON.parse(row.row_json).review_id === ownerless.reviewId)).toBe(true);
        const pendingColumns = migrated
          .prepare("PRAGMA table_info(durable_review_pending_records)")
          .all() as Array<{ name: string }>;
        expect(pendingColumns.map((column) => column.name)).toContain("owner_tenant_id");
        const pendingIndexes = migrated
          .prepare("PRAGMA index_list(durable_review_pending_records)")
          .all() as Array<{ name: string }>;
        expect(pendingIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
          "durable_review_pending_records_created",
          "durable_review_pending_records_domain",
          "durable_review_pending_records_source",
          "durable_review_pending_records_owner",
        ]));
        expect(migrated.prepare("PRAGMA foreign_key_list(durable_review_resolutions)").all()).toHaveLength(5);
        expect(() => migrated.prepare("UPDATE durable_review_pending_records SET source_id = 'changed' WHERE review_id = ?").run(owned.reviewId)).toThrow(/append-only/);
      } finally {
        migrated.close();
      }
    } finally {
      store.close();
      database.remove();
    }
  });

  it("preserves legacy v1 resolved rows on upgrade without presenting them as pending v2 queue work", async () => {
    const database = temporaryDatabasePath(); const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const old = await legacy("old-review");
    const raw = new sqlite.DatabaseSync(database.path);
    try { raw.exec("CREATE TABLE durable_review_records (seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL, domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL)"); raw.prepare("INSERT INTO durable_review_records (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(old.reviewId, old.createdAtUtc, old.intake.domainId, old.intake.source.sourceId, old.intake.input.inputId, old.receipt.receiptId, old.receipt.receiptSha256, JSON.stringify(old)); } finally { raw.close(); }
    const store = DurableReviewStore.open(database.path);
    try {
      expect(store.count()).toBe(0);
      expect(store.get("old-review", aliceOwner)).toBeNull();
      expect(store.legacyCount()).toBe(1);
      expect(store.getLegacy("old-review")?.record).toEqual(old);
      expect(store.listLegacy().map((entry) => entry.record)).toEqual([old]);
      const next = await pending("new-review");
      await store.appendPending(next);
      expect(store.list({}, aliceOwner).map((entry) => entry.reviewId)).toEqual(["new-review"]);
      expect(store.listLegacy().map((entry) => entry.reviewId)).toEqual(["old-review"]);
    } finally { store.close(); database.remove(); }
  });

  it("keeps compatibility-only v1 append isolated from the pending queue", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const old = await legacy("legacy-review"); await store.append(old); expect(store.legacyCount()).toBe(1); expect(store.count()).toBe(0); expect(store.get("legacy-review", aliceOwner)).toBeNull(); expect(store.getLegacy("legacy-review")?.record).toEqual(old); } finally { store.close(); }
  });
});
