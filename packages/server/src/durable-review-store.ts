import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { DomainError, IdSchema, canonicalize } from "@changesafe/core";

import {
  acceptDurableReviewRecordForPersistence,
  acceptPendingDurableReviewRecordForPersistence,
  bindServerResolutionToPendingReview,
  DurableReviewRecordSchema,
  DurableReviewResolutionSchema,
  PendingDurableReviewRecordSchema,
  type DurableReviewRecord,
  type DurableReviewResolution,
  type PendingDurableReviewRecord,
} from "../../../features/reviews/durable-review-contract";

/**
 * The review queue is separate from the receipt ledger. V2 first appends a
 * verified, receipt-free intake, then appends a distinct server resolution.
 * Neither table is a mutable work queue and neither is the ledger.
 */

const PendingRowSchema = z.strictObject({
  seq: z.number().int().positive(), review_id: IdSchema, created_at_utc: z.string(),
  domain_id: z.enum(["network", "terraform"]), source_id: IdSchema, input_id: IdSchema,
  record_json: z.string(),
});
const ResolutionRowSchema = z.strictObject({
  seq: z.number().int().positive(), review_id: IdSchema, resolved_at_utc: z.string(),
  receipt_id: IdSchema, receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/), resolution_json: z.string(),
});
const LegacyRowSchema = z.strictObject({
  seq: z.number().int().positive(), review_id: IdSchema, created_at_utc: z.string(),
  domain_id: z.enum(["network", "terraform"]), source_id: IdSchema, input_id: IdSchema,
  receipt_id: IdSchema, receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/), record_json: z.string(),
});
type PendingRow = z.infer<typeof PendingRowSchema>;
type ResolutionRow = z.infer<typeof ResolutionRowSchema>;
type LegacyRow = z.infer<typeof LegacyRowSchema>;

export interface DurableReviewStoreEntry {
  seq: number; reviewId: string; createdAtUtc: string; domainId: "network" | "terraform";
  sourceId: string; inputId: string; record: PendingDurableReviewRecord;
}
export interface DurableReviewResolutionEntry {
  seq: number; reviewId: string; resolvedAtUtc: string; receiptId: string; receiptSha256: string;
  resolution: DurableReviewResolution;
}
/** Read-only compatibility surface for resolved v1 rows. They are not queue items. */
export interface LegacyDurableReviewStoreEntry {
  seq: number; reviewId: string; createdAtUtc: string; domainId: "network" | "terraform";
  sourceId: string; inputId: string; receiptId: string; receiptSha256: string; record: DurableReviewRecord;
}
export interface DurableReviewStoreListOptions { limit?: number; domainId?: "network" | "terraform"; sourceId?: string; }
const ListOptionsSchema = z.strictObject({ limit: z.number().finite().optional(), domainId: z.enum(["network", "terraform"]).optional(), sourceId: IdSchema.optional() });
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 1000;

// `durable_review_records` is v1 compatibility data. Do not rewrite it into a
// pending item: it represents an already-resolved historical record, and its
// receipt is not evidence that a new v2 resolution was appended.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS durable_review_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL,
  domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS durable_review_pending_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL,
  domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL, record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS durable_review_resolutions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, resolved_at_utc TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, resolution_json TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES durable_review_pending_records(review_id)
);
CREATE INDEX IF NOT EXISTS durable_review_pending_records_created ON durable_review_pending_records (created_at_utc);
CREATE INDEX IF NOT EXISTS durable_review_pending_records_domain ON durable_review_pending_records (domain_id);
CREATE INDEX IF NOT EXISTS durable_review_pending_records_source ON durable_review_pending_records (source_id);
`;

const TABLES = [
  { table: "durable_review_records", keys: ["review_id", "receipt_id", "receipt_sha256"] },
  { table: "durable_review_pending_records", keys: ["review_id"] },
  { table: "durable_review_resolutions", keys: ["review_id", "receipt_id", "receipt_sha256"] },
] as const;

function triggerSql(table: string, keys: readonly string[]): string {
  const names = { update: `${table}_no_update`, delete: `${table}_no_delete`, insert: `${table}_no_conflicting_insert` };
  const checks = [...keys.map((key) => `${key} = NEW.${key}`), "(NEW.seq > 0 AND seq = NEW.seq)"].join(" OR ");
  return `
CREATE TRIGGER ${names.update} BEFORE UPDATE ON ${table} BEGIN
 SELECT RAISE(ABORT, '${table} is append-only: rows cannot be updated'); END;
CREATE TRIGGER ${names.delete} BEFORE DELETE ON ${table} BEGIN
 SELECT RAISE(ABORT, '${table} is append-only: rows cannot be deleted'); END;
CREATE TRIGGER ${names.insert} BEFORE INSERT ON ${table}
WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${checks}) BEGIN
 SELECT RAISE(ABORT, '${table} is append-only: existing bindings cannot be replaced'); END;`;
}

const nodeRequire = createRequire(import.meta.url);
function openDatabase(path: string): DatabaseSync { const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); return new sqlite.DatabaseSync(path); }
function upgradeTriggers(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { table } of TABLES) for (const suffix of ["no_update", "no_delete", "no_conflicting_insert"]) db.exec(`DROP TRIGGER IF EXISTS ${table}_${suffix}`);
    for (const { table, keys } of TABLES) db.exec(triggerSql(table, keys));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
function pendingEntry(row: PendingRow): DurableReviewStoreEntry { return { seq: row.seq, reviewId: row.review_id, createdAtUtc: row.created_at_utc, domainId: row.domain_id, sourceId: row.source_id, inputId: row.input_id, record: PendingDurableReviewRecordSchema.parse(JSON.parse(row.record_json)) }; }
function resolutionEntry(row: ResolutionRow): DurableReviewResolutionEntry { return { seq: row.seq, reviewId: row.review_id, resolvedAtUtc: row.resolved_at_utc, receiptId: row.receipt_id, receiptSha256: row.receipt_sha256, resolution: DurableReviewResolutionSchema.parse(JSON.parse(row.resolution_json)) }; }
function legacyEntry(row: LegacyRow): LegacyDurableReviewStoreEntry { return { seq: row.seq, reviewId: row.review_id, createdAtUtc: row.created_at_utc, domainId: row.domain_id, sourceId: row.source_id, inputId: row.input_id, receiptId: row.receipt_id, receiptSha256: row.receipt_sha256, record: DurableReviewRecordSchema.parse(JSON.parse(row.record_json)) }; }
function limitOf(raw: number | undefined): number { return Math.min(Math.max(Math.trunc(raw ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT); }

export class DurableReviewStore {
  readonly #db: DatabaseSync;
  #writes: Promise<void> = Promise.resolve();
  private constructor(db: DatabaseSync) { this.#db = db; }
  static open(path: string): DurableReviewStore {
    const db = openDatabase(path);
    db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA foreign_keys = ON"); db.exec("PRAGMA recursive_triggers = ON");
    db.exec(SCHEMA); upgradeTriggers(db); return new DurableReviewStore(db);
  }
  close(): void { this.#db.close(); }
  /** Number of v2 pending intake records, never historical v1 resolved rows. */
  count(): number { return z.strictObject({ count: z.number().int().nonnegative() }).parse(this.#db.prepare("SELECT count(*) AS count FROM durable_review_pending_records").get()).count; }
  legacyCount(): number { return z.strictObject({ count: z.number().int().nonnegative() }).parse(this.#db.prepare("SELECT count(*) AS count FROM durable_review_records").get()).count; }

  async appendPending(raw: unknown): Promise<DurableReviewStoreEntry> {
    const accepted = await acceptPendingDurableReviewRecordForPersistence(raw);
    return this.#queue(() => this.#appendPending(accepted));
  }
  #appendPending(record: PendingDurableReviewRecord): DurableReviewStoreEntry {
    const existing = this.get(record.reviewId);
    if (existing) { if (canonicalize(existing.record) === canonicalize(record)) return existing; throw new DomainError("REQUEST_INVALID", `Review ${record.reviewId} already records different immutable metadata.`); }
    try { this.#db.prepare("INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?)").run(record.reviewId, record.createdAtUtc, record.intake.domainId, record.intake.source.sourceId, record.intake.input.inputId, canonicalize(record)); }
    catch (error) { const raced = this.get(record.reviewId); if (raced) { if (canonicalize(raced.record) === canonicalize(record)) return raced; throw new DomainError("REQUEST_INVALID", `Review ${record.reviewId} already records different immutable metadata.`); } throw error; }
    const inserted = this.get(record.reviewId); if (!inserted) throw new DomainError("INTERNAL", "The review store accepted a pending record but could not read it back."); return inserted;
  }

  /** Append a receipt binding only after the server has recomputed its verdict. */
  async bindServerResolution(reviewId: string, raw: unknown): Promise<DurableReviewResolutionEntry> {
    const pending = this.get(reviewId); if (!pending) throw new DomainError("REQUEST_INVALID", `No pending durable review exists for ${reviewId}.`);
    const accepted = bindServerResolutionToPendingReview(pending.record, raw);
    return this.#queue(() => this.#appendResolution(pending.record, accepted));
  }
  #appendResolution(pending: PendingDurableReviewRecord, resolution: DurableReviewResolution): DurableReviewResolutionEntry {
    const existing = this.getResolution(pending.reviewId);
    if (existing) { if (canonicalize(existing.resolution) === canonicalize(resolution)) return existing; throw new DomainError("REQUEST_INVALID", `Review ${pending.reviewId} already records a different immutable resolution.`); }
    try { this.#db.prepare("INSERT INTO durable_review_resolutions (review_id, resolved_at_utc, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?)").run(resolution.reviewId, resolution.resolvedAtUtc, resolution.receipt.receiptId, resolution.receipt.receiptSha256, canonicalize(resolution)); }
    catch (error) {
      const raced = this.getResolution(pending.reviewId); if (raced) { if (canonicalize(raced.resolution) === canonicalize(resolution)) return raced; throw new DomainError("REQUEST_INVALID", `Review ${pending.reviewId} already records a different immutable resolution.`); }
      const collision = this.#db.prepare("SELECT review_id FROM durable_review_resolutions WHERE receipt_id = ? OR receipt_sha256 = ? LIMIT 1").get(resolution.receipt.receiptId, resolution.receipt.receiptSha256);
      if (collision) throw new DomainError("REQUEST_INVALID", `Receipt ${resolution.receipt.receiptId} or its content hash is already bound to review ${z.strictObject({ review_id: IdSchema }).parse(collision).review_id}.`);
      throw error;
    }
    const inserted = this.getResolution(pending.reviewId); if (!inserted) throw new DomainError("INTERNAL", "The review store accepted a resolution but could not read it back."); return inserted;
  }

  // Compatibility-only v1 append. New endpoints must call appendPending; v1
  // rows stay readable but never appear in the pending queue.
  async append(raw: unknown): Promise<LegacyDurableReviewStoreEntry> { const accepted = await acceptDurableReviewRecordForPersistence(raw); return this.#queue(() => this.#appendLegacy(accepted)); }
  #appendLegacy(record: DurableReviewRecord): LegacyDurableReviewStoreEntry {
    const old = this.getLegacy(record.reviewId); if (old) { if (canonicalize(old.record) === canonicalize(record)) return old; throw new DomainError("REQUEST_INVALID", `Review ${record.reviewId} already records different immutable metadata.`); }
    try { this.#db.prepare("INSERT INTO durable_review_records (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(record.reviewId, record.createdAtUtc, record.intake.domainId, record.intake.source.sourceId, record.intake.input.inputId, record.receipt.receiptId, record.receipt.receiptSha256, canonicalize(record)); }
    catch (error) { const raced = this.getLegacy(record.reviewId); if (raced) { if (canonicalize(raced.record) === canonicalize(record)) return raced; throw new DomainError("REQUEST_INVALID", `Review ${record.reviewId} already records different immutable metadata.`); } throw error; }
    const inserted = this.getLegacy(record.reviewId); if (!inserted) throw new DomainError("INTERNAL", "The legacy review store accepted a record but could not read it back."); return inserted;
  }
  #queue<T>(task: () => T): Promise<T> { const result = this.#writes.then(task, task); this.#writes = result.then(() => undefined, () => undefined); return result; }
  get(reviewId: string): DurableReviewStoreEntry | null { const row = this.#db.prepare("SELECT * FROM durable_review_pending_records WHERE review_id = ?").get(IdSchema.parse(reviewId)); return row ? pendingEntry(PendingRowSchema.parse(row)) : null; }
  getResolution(reviewId: string): DurableReviewResolutionEntry | null { const row = this.#db.prepare("SELECT * FROM durable_review_resolutions WHERE review_id = ?").get(IdSchema.parse(reviewId)); return row ? resolutionEntry(ResolutionRowSchema.parse(row)) : null; }
  getLegacy(reviewId: string): LegacyDurableReviewStoreEntry | null { const row = this.#db.prepare("SELECT * FROM durable_review_records WHERE review_id = ?").get(IdSchema.parse(reviewId)); return row ? legacyEntry(LegacyRowSchema.parse(row)) : null; }
  list(options: DurableReviewStoreListOptions = {}): DurableReviewStoreEntry[] {
    const valid = ListOptionsSchema.parse(options); const clauses: string[] = []; const params: string[] = [];
    if (valid.domainId) { clauses.push("domain_id = ?"); params.push(valid.domainId); } if (valid.sourceId) { clauses.push("source_id = ?"); params.push(valid.sourceId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db.prepare(`SELECT * FROM durable_review_pending_records ${where} ORDER BY seq DESC LIMIT ${limitOf(valid.limit)}`).all(...params).map((row) => pendingEntry(PendingRowSchema.parse(row)));
  }
  listLegacy(options: DurableReviewStoreListOptions = {}): LegacyDurableReviewStoreEntry[] {
    const valid = ListOptionsSchema.parse(options); const clauses: string[] = []; const params: string[] = [];
    if (valid.domainId) { clauses.push("domain_id = ?"); params.push(valid.domainId); } if (valid.sourceId) { clauses.push("source_id = ?"); params.push(valid.sourceId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db.prepare(`SELECT * FROM durable_review_records ${where} ORDER BY seq DESC LIMIT ${limitOf(valid.limit)}`).all(...params).map((row) => legacyEntry(LegacyRowSchema.parse(row)));
  }
}
