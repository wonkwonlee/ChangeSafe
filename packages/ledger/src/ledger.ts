import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import {
  ChangeReceiptSchema,
  DomainError,
  SignedReceiptSchema,
  canonicalize,
  verifyReceiptHash,
  type ChangeReceipt,
  type SignedReceipt,
} from "@changesafe/core";

import { GENESIS_CHAIN_SHA256, computeChainHash } from "./chain";

/**
 * The append-only receipt ledger.
 *
 * Backed by `node:sqlite`, which ships with Node — a self-hoster gets durable
 * storage without a native build step, a server process, or a dependency this
 * project would have to vouch for.
 *
 * Append-only is enforced by the database, not by convention: UPDATE and
 * DELETE on the receipts table abort in a trigger. That stops the ordinary
 * mistake (a stray statement, a well-meaning cleanup script). It does not
 * stop someone who owns the file, which is what the hash chain is for.
 */

/** A record as stored: either a bare receipt or a signed envelope. */
export type LedgerRecord = ChangeReceipt | SignedReceipt;

export interface LedgerEntry {
  seq: number;
  receiptId: string;
  createdAtUtc: string;
  decision: string;
  riskLevel: string;
  sourceId: string;
  inputId: string;
  proposalId: string;
  receiptSha256: string;
  /** Key fingerprint when the stored record was signed; null otherwise. */
  signatureKeyId: string | null;
  previousChainSha256: string;
  chainSha256: string;
  record: LedgerRecord;
}

export interface ChainBreak {
  seq: number;
  receiptId: string;
  reason: string;
}

export interface ChainVerdict {
  ok: boolean;
  entries: number;
  /** Chain head — what a witness would record to detect later rewrites. */
  headChainSha256: string | null;
  breaks: ChainBreak[];
}

/**
 * Stored rows are parsed, not asserted. The database file is a boundary
 * input like any other — and for a feature whose whole purpose is detecting
 * tampering, trusting its shape on faith would be the wrong instinct.
 */
const RowSchema = z.object({
  seq: z.number().int().positive(),
  receipt_id: z.string(),
  created_at_utc: z.string(),
  decision: z.string(),
  risk_level: z.string(),
  source_id: z.string(),
  input_id: z.string(),
  proposal_id: z.string(),
  receipt_sha256: z.string(),
  signature_key_id: z.string().nullable(),
  previous_chain_sha256: z.string(),
  chain_sha256: z.string(),
  record_json: z.string(),
});

type Row = z.infer<typeof RowSchema>;

const SCHEMA_VERSION = 1;

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  seq                   INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id            TEXT NOT NULL UNIQUE,
  created_at_utc        TEXT NOT NULL,
  decision              TEXT NOT NULL,
  risk_level            TEXT NOT NULL,
  source_id             TEXT NOT NULL,
  input_id              TEXT NOT NULL,
  proposal_id           TEXT NOT NULL,
  receipt_sha256        TEXT NOT NULL,
  signature_key_id      TEXT,
  previous_chain_sha256 TEXT NOT NULL,
  chain_sha256          TEXT NOT NULL,
  record_json           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS receipts_created_at ON receipts (created_at_utc);
CREATE INDEX IF NOT EXISTS receipts_source ON receipts (source_id);

-- Append-only, enforced where the data lives rather than in application code
-- that a different caller could bypass.
CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'the receipt ledger is append-only: entries cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'the receipt ledger is append-only: entries cannot be deleted');
END;
`;

/**
 * `node:sqlite` is loaded when a ledger is actually opened, not when this
 * module is imported.
 *
 * It is still an experimental Node builtin, so importing it prints a warning
 * to stderr — and the CLI bundles every command into one file, which meant
 * `changesafe gate` announced an experimental database it never touches on
 * every CI run. A static import cannot be deferred (ESM hoists it), so the
 * builtin is required at open time instead.
 */
const nodeRequire = createRequire(import.meta.url);

function openDatabase(path: string): DatabaseSync {
  const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(path);
}

function splitRecord(record: LedgerRecord): {
  receipt: ChangeReceipt;
  signatureKeyId: string | null;
} {
  if ("receipt" in record) {
    return { receipt: record.receipt, signatureKeyId: record.signature.publicKeyId };
  }
  return { receipt: record, signatureKeyId: null };
}

/** Parse a stored record back into its validated shape. */
function parseRecord(json: string): LedgerRecord {
  const raw: unknown = JSON.parse(json);
  const isEnvelope = typeof raw === "object" && raw !== null && "receipt" in raw;
  return isEnvelope ? SignedReceiptSchema.parse(raw) : ChangeReceiptSchema.parse(raw);
}

function toEntry(row: Row): LedgerEntry {
  return {
    seq: row.seq,
    receiptId: row.receipt_id,
    createdAtUtc: row.created_at_utc,
    decision: row.decision,
    riskLevel: row.risk_level,
    sourceId: row.source_id,
    inputId: row.input_id,
    proposalId: row.proposal_id,
    receiptSha256: row.receipt_sha256,
    signatureKeyId: row.signature_key_id,
    previousChainSha256: row.previous_chain_sha256,
    chainSha256: row.chain_sha256,
    record: parseRecord(row.record_json),
  };
}

export interface ListOptions {
  limit?: number;
  /** Return only entries recorded for this source. */
  sourceId?: string;
  /** Return only entries with this decision. */
  decision?: string;
}

export class Ledger {
  readonly #db: DatabaseSync;
  /** Tail of the append queue; see `append`. */
  #writes: Promise<void> = Promise.resolve();

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /**
   * Open (creating if needed) a ledger file. Pass `":memory:"` for a
   * throwaway ledger in tests.
   */
  static open(path: string): Ledger {
    const db = openDatabase(path);
    // Durability over speed: a receipt that was reported as recorded must
    // survive the process dying immediately afterwards.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return new Ledger(db);
  }

  close(): void {
    this.#db.close();
  }

  /** The most recent entry's chain digest, or the genesis value when empty. */
  head(): string {
    const row = this.#db
      .prepare("SELECT chain_sha256 AS h FROM receipts ORDER BY seq DESC LIMIT 1")
      .get();
    return row ? z.object({ h: z.string() }).parse(row).h : GENESIS_CHAIN_SHA256;
  }

  count(): number {
    const row = this.#db.prepare("SELECT count(*) AS c FROM receipts").get();
    return z.object({ c: z.number() }).parse(row).c;
  }

  /**
   * Record a receipt.
   *
   * Recording the same receipt twice is rejected rather than ignored: a
   * duplicate means the caller lost track of whether a decision was already
   * durable, and silently succeeding would hide that.
   *
   * Appends are serialized against each other. Deciding the next entry means
   * reading the chain head and then hashing, and hashing is asynchronous — so
   * two decisions arriving together would both read the same head and build
   * the same link, and the second would land on the sequence number the first
   * just took. The database refuses that (`seq` is the primary key), which is
   * the right failure but an unhelpful one: the second approver's genuine
   * decision would come back as an internal error rather than the next entry
   * in the chain. Queueing costs nothing here — a hash is microseconds — and
   * turns a collision into an ordering.
   *
   * A second *process* writing the same file is still caught by the
   * constraint rather than by this queue, which is why the constraint stays.
   */
  async append(record: LedgerRecord): Promise<LedgerEntry> {
    // Each append waits for the one before it, whether that one succeeded or
    // failed: a rejected append must not break the queue for the next caller.
    const result = this.#writes.then(
      () => this.#appendSerially(record),
      () => this.#appendSerially(record),
    );
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #appendSerially(record: LedgerRecord): Promise<LedgerEntry> {
    const { receipt, signatureKeyId } = splitRecord(record);

    if (this.get(receipt.receiptId)) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Receipt ${receipt.receiptId} is already in the ledger. Entries are append-only and never replaced.`,
      );
    }

    const previousChainSha256 = this.head();
    const seq = this.#nextSeq();
    const chainSha256 = await computeChainHash({
      seq,
      receiptSha256: receipt.receiptSha256,
      previousChainSha256,
    });

    this.#db
      .prepare(
        `INSERT INTO receipts (
           seq, receipt_id, created_at_utc, decision, risk_level, source_id,
           input_id, proposal_id, receipt_sha256, signature_key_id,
           previous_chain_sha256, chain_sha256, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq,
        receipt.receiptId,
        receipt.createdAtUtc,
        receipt.decision,
        receipt.riskLevel,
        receipt.sourceId,
        receipt.inputId,
        receipt.proposalId,
        receipt.receiptSha256,
        signatureKeyId,
        previousChainSha256,
        chainSha256,
        // Canonical form so a stored record hashes identically wherever it is
        // read back.
        canonicalize(record),
      );

    const entry = this.get(receipt.receiptId);
    if (!entry) {
      throw new DomainError("INTERNAL", "The ledger accepted a receipt but could not read it back.");
    }
    return entry;
  }

  get(receiptId: string): LedgerEntry | null {
    const row = this.#db
      .prepare("SELECT * FROM receipts WHERE receipt_id = ?")
      .get(receiptId);
    return row ? toEntry(RowSchema.parse(row)) : null;
  }

  list(options: ListOptions = {}): LedgerEntry[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (options.sourceId) {
      clauses.push("source_id = ?");
      params.push(options.sourceId);
    }
    if (options.decision) {
      clauses.push("decision = ?");
      params.push(options.decision);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    // The limit is the one value interpolated into SQL rather than bound, so
    // it has to be a whole number before it gets there: NaN clamps to NaN and
    // a fraction stays a fraction, and SQLite answers both with an error the
    // caller reads as the server having broken.
    const requested = options.limit ?? DEFAULT_LIST_LIMIT;
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

    const rows = this.#db
      .prepare(`SELECT * FROM receipts ${where} ORDER BY seq DESC LIMIT ${limit}`)
      .all(...params);
    return rows.map((row) => toEntry(RowSchema.parse(row)));
  }

  /**
   * Recompute the whole chain and report every broken link.
   *
   * Catches what the append-only triggers cannot: someone editing the
   * database file directly, or rebuilding the table. A gap in the sequence is
   * itself a break — that is the case a plain receipts table cannot see.
   */
  async verifyChain(): Promise<ChainVerdict> {
    const rows = this.#db
      .prepare("SELECT * FROM receipts ORDER BY seq ASC")
      .all()
      .map((row) => RowSchema.parse(row));
    const breaks: ChainBreak[] = [];

    let previous = GENESIS_CHAIN_SHA256;
    let expectedSeq = 1;

    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: `expected sequence ${expectedSeq} but found ${row.seq} — an entry was removed or reordered`,
        });
        expectedSeq = row.seq;
      }
      if (row.previous_chain_sha256 !== previous) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "this entry does not link to the preceding entry",
        });
      }

      const recomputed = await computeChainHash({
        seq: row.seq,
        receiptSha256: row.receipt_sha256,
        previousChainSha256: row.previous_chain_sha256,
      });
      if (recomputed !== row.chain_sha256) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "the stored chain digest does not match this entry's content",
        });
      }

      // Two distinct ways the stored receipt can stop being the one this
      // entry recorded, and both have to be checked.
      const { receipt } = splitRecord(parseRecord(row.record_json));

      // 1. Content edited while its own digest field was left alone.
      //    Comparing the two stored digests would happily agree here, so the
      //    hash has to be recomputed from the content.
      if (!(await verifyReceiptHash(receipt))) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "the stored receipt's content does not match its own receiptSha256",
        });
      }

      // 2. A different, internally consistent receipt swapped in.
      if (receipt.receiptSha256 !== row.receipt_sha256) {
        breaks.push({
          seq: row.seq,
          receiptId: row.receipt_id,
          reason: "the stored receipt is not the one this entry recorded",
        });
      }

      previous = row.chain_sha256;
      expectedSeq += 1;
    }

    return {
      ok: breaks.length === 0,
      entries: rows.length,
      headChainSha256: rows.length > 0 ? previous : null,
      breaks,
    };
  }

  /** Next sequence number, derived from the chain rather than AUTOINCREMENT. */
  #nextSeq(): number {
    const row = this.#db.prepare("SELECT max(seq) AS m FROM receipts").get();
    return (z.object({ m: z.number().nullable() }).parse(row).m ?? 0) + 1;
  }
}
