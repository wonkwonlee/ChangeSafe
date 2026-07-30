import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { DomainError, IdSchema, canonicalize } from "@changesafe/core";

import {
  acceptDurableReviewRecordForPersistence,
  DurableReviewRecordSchema,
  type DurableReviewRecord,
} from "../../../features/reviews/durable-review-contract";

/**
 * The self-hosted review queue is deliberately separate from the receipt
 * ledger. It records immutable review metadata before the later decision
 * workflow appends a receipt to the ledger; it is never a substitute for the
 * ledger's tamper-evident audit chain.
 */

const RowSchema = z.strictObject({
  seq: z.number().int().positive(),
  review_id: IdSchema,
  created_at_utc: z.string(),
  domain_id: z.enum(["network", "terraform"]),
  source_id: IdSchema,
  input_id: IdSchema,
  receipt_id: IdSchema,
  receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  record_json: z.string(),
});

type Row = z.infer<typeof RowSchema>;

export interface DurableReviewStoreEntry {
  seq: number;
  reviewId: string;
  createdAtUtc: string;
  domainId: "network" | "terraform";
  sourceId: string;
  inputId: string;
  receiptId: string;
  receiptSha256: string;
  record: DurableReviewRecord;
}

export interface DurableReviewStoreListOptions {
  limit?: number;
  domainId?: "network" | "terraform";
  sourceId?: string;
}

const ListOptionsSchema = z.strictObject({
  limit: z.number().finite().optional(),
  domainId: z.enum(["network", "terraform"]).optional(),
  sourceId: IdSchema.optional(),
});

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS durable_review_records (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id      TEXT NOT NULL UNIQUE,
  created_at_utc TEXT NOT NULL,
  domain_id      TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  input_id       TEXT NOT NULL,
  receipt_id     TEXT NOT NULL UNIQUE,
  receipt_sha256 TEXT NOT NULL UNIQUE,
  record_json    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS durable_review_records_created
  ON durable_review_records (created_at_utc);
CREATE INDEX IF NOT EXISTS durable_review_records_domain
  ON durable_review_records (domain_id);
CREATE INDEX IF NOT EXISTS durable_review_records_source
  ON durable_review_records (source_id);

-- These unique indexes also protect databases created before the receipt
-- columns became one-to-one bindings.  The queue must never let a receipt
-- identity or its content hash appear to belong to two different reviews.
CREATE UNIQUE INDEX IF NOT EXISTS durable_review_records_receipt_id_unique
  ON durable_review_records (receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS durable_review_records_receipt_sha256_unique
  ON durable_review_records (receipt_sha256);

-- INSERT OR REPLACE normally resolves a uniqueness conflict by deleting the
-- conflicting row before inserting its replacement.  DELETE triggers only
-- observe that implicit deletion when a connection opts into
-- recursive_triggers, which is a connection-local pragma.  The queue must
-- therefore reject a conflict at the incoming INSERT boundary too: this guard
-- runs before SQLite can choose the REPLACE conflict action, including on a
-- raw/default connection.
CREATE TRIGGER IF NOT EXISTS durable_review_records_no_conflicting_insert
BEFORE INSERT ON durable_review_records
WHEN EXISTS (
  SELECT 1
  FROM durable_review_records
  WHERE review_id = NEW.review_id
     OR receipt_id = NEW.receipt_id
     OR receipt_sha256 = NEW.receipt_sha256
     -- An omitted INTEGER PRIMARY KEY is represented as a non-positive
     -- placeholder during a BEFORE INSERT trigger. Only a positive incoming
     -- value can name an existing immutable sequence row, so preserve normal
     -- AUTOINCREMENT assignment while rejecting an explicit seq REPLACE.
     OR (NEW.seq > 0 AND seq = NEW.seq)
)
BEGIN
  SELECT RAISE(ABORT, 'durable review records are append-only: existing bindings cannot be replaced');
END;

CREATE TRIGGER IF NOT EXISTS durable_review_records_no_update
BEFORE UPDATE ON durable_review_records
BEGIN
  SELECT RAISE(ABORT, 'durable review records are append-only: records cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS durable_review_records_no_delete
BEFORE DELETE ON durable_review_records
BEGIN
  SELECT RAISE(ABORT, 'durable review records are append-only: records cannot be deleted');
END;
`;

const nodeRequire = createRequire(import.meta.url);

function openDatabase(path: string): DatabaseSync {
  const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(path);
}

function toEntry(row: Row): DurableReviewStoreEntry {
  return {
    seq: row.seq,
    reviewId: row.review_id,
    createdAtUtc: row.created_at_utc,
    domainId: row.domain_id,
    sourceId: row.source_id,
    inputId: row.input_id,
    receiptId: row.receipt_id,
    receiptSha256: row.receipt_sha256,
    // Stored JSON is untrusted database input. Structural parsing makes a
    // damaged/malformed row fail closed on read; `append` is the async hash
    // acceptance boundary before any row can be inserted.
    record: DurableReviewRecordSchema.parse(JSON.parse(row.record_json)),
  };
}

/**
 * Append-only metadata store for authenticated self-hosted reviews.
 *
 * `append` is intentionally the sole write API. It first invokes the shared
 * asynchronous acceptance boundary, then atomically inserts one immutable
 * row. A future decision coordinator can compose this store with ledger
 * recording, but no decision or ledger write happens here.
 */
export class DurableReviewStore {
  readonly #db: DatabaseSync;
  #writes: Promise<void> = Promise.resolve();

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  static open(path: string): DurableReviewStore {
    const db = openDatabase(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    // Keep recursive triggers on for service-owned connections so direct
    // DELETE/UPDATE protections remain fully observable. The schema-level
    // conflicting-insert guard below independently blocks INSERT OR REPLACE
    // even when a raw connection leaves this pragma at SQLite's default OFF.
    db.exec("PRAGMA recursive_triggers = ON");
    db.exec(SCHEMA);
    return new DurableReviewStore(db);
  }

  close(): void {
    this.#db.close();
  }

  count(): number {
    const row = this.#db.prepare("SELECT count(*) AS count FROM durable_review_records").get();
    return z.strictObject({ count: z.number().int().nonnegative() }).parse(row).count;
  }

  /**
   * Accept and append a record. Repeating the exact immutable record is
   * idempotent; a matching ID with different metadata is rejected rather than
   * silently replacing the original queue item.
   */
  async append(raw: unknown): Promise<DurableReviewStoreEntry> {
    const accepted = await acceptDurableReviewRecordForPersistence(raw);
    const result = this.#writes.then(
      () => this.#appendSerially(accepted),
      () => this.#appendSerially(accepted),
    );
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #appendSerially(record: DurableReviewRecord): DurableReviewStoreEntry {
    const existing = this.get(record.reviewId);
    if (existing) {
      if (canonicalize(existing.record) === canonicalize(record)) {
        return existing;
      }
      throw new DomainError(
        "REQUEST_INVALID",
        `Review ${record.reviewId} already records different immutable metadata.`,
      );
    }

    try {
      this.#db
        .prepare(
          `INSERT INTO durable_review_records (
             review_id, created_at_utc, domain_id, source_id, input_id,
             receipt_id, receipt_sha256, record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.reviewId,
          record.createdAtUtc,
          record.intake.domainId,
          record.intake.source.sourceId,
          record.intake.input.inputId,
          record.receipt.receiptId,
          record.receipt.receiptSha256,
          canonicalize(record),
        );
    } catch (error) {
      // A second process can insert between the optimistic read above and our
      // INSERT. Re-read the authoritative row: only byte-for-byte equivalent
      // immutable records are idempotent; every other collision fails closed.
      const raced = this.get(record.reviewId);
      if (raced) {
        if (canonicalize(raced.record) === canonicalize(record)) {
          return raced;
        }
        throw new DomainError(
          "REQUEST_INVALID",
          `Review ${record.reviewId} already records different immutable metadata.`,
        );
      }

      const receiptCollision = this.#db
        .prepare(
          "SELECT review_id FROM durable_review_records WHERE receipt_id = ? OR receipt_sha256 = ? LIMIT 1",
        )
        .get(record.receipt.receiptId, record.receipt.receiptSha256);
      if (receiptCollision) {
        const row = z.strictObject({ review_id: IdSchema }).parse(receiptCollision);
        throw new DomainError(
          "REQUEST_INVALID",
          `Receipt ${record.receipt.receiptId} or its content hash is already bound to review ${row.review_id}.`,
        );
      }

      throw error;
    }

    const inserted = this.get(record.reviewId);
    if (!inserted) {
      throw new DomainError("INTERNAL", "The review store accepted a record but could not read it back.");
    }
    return inserted;
  }

  get(reviewId: string): DurableReviewStoreEntry | null {
    const validReviewId = IdSchema.parse(reviewId);
    const row = this.#db
      .prepare("SELECT * FROM durable_review_records WHERE review_id = ?")
      .get(validReviewId);
    return row ? toEntry(RowSchema.parse(row)) : null;
  }

  list(options: DurableReviewStoreListOptions = {}): DurableReviewStoreEntry[] {
    const valid = ListOptionsSchema.parse(options);
    const clauses: string[] = [];
    const params: string[] = [];
    if (valid.domainId) {
      clauses.push("domain_id = ?");
      params.push(valid.domainId);
    }
    if (valid.sourceId) {
      clauses.push("source_id = ?");
      params.push(valid.sourceId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const requested = valid.limit ?? DEFAULT_LIST_LIMIT;
    const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_LIST_LIMIT);
    const rows = this.#db
      .prepare(`SELECT * FROM durable_review_records ${where} ORDER BY seq DESC LIMIT ${limit}`)
      .all(...params);
    return rows.map((row) => toEntry(RowSchema.parse(row)));
  }
}
