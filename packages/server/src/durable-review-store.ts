import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { DomainError, IdSchema, canonicalize } from "@changesafe/core";

import {
  acceptDurableReviewRecordForPersistence,
  acceptPendingDurableReviewRecordForPersistence,
  bindServerResolutionToPendingReview,
  DurableReviewDecisionClaimSchema,
  DurableReviewRecordSchema,
  DurableReviewResolutionSchema,
  DurableReviewOwnerSchema,
  PendingDurableReviewRecordSchema,
  type DurableReviewRecord,
  type DurableReviewDecisionClaim,
  type DurableReviewResolution,
  type DurableReviewOwner,
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
  owner_tenant_id: z.string(), owner_issuer: z.string(), owner_subject: z.string(),
  owner_scope: z.literal("self-hosted-review"),
  record_json: z.string(),
});
const ResolutionRowSchema = z.strictObject({
  seq: z.number().int().positive(), review_id: IdSchema, resolved_at_utc: z.string(),
  owner_tenant_id: z.string(), owner_issuer: z.string(), owner_subject: z.string(),
  owner_scope: z.literal("self-hosted-review"),
  receipt_id: IdSchema, receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/), resolution_json: z.string(),
});
const DecisionClaimRowSchema = z.strictObject({
  seq: z.number().int().positive(),
  review_id: IdSchema,
  owner_tenant_id: z.string(),
  owner_issuer: z.string(),
  owner_subject: z.string(),
  owner_scope: z.literal("self-hosted-review"),
  decision: z.enum(["approve", "reject"]),
  claimed_at_utc: z.string(),
  receipt_id: IdSchema,
  claim_json: z.string(),
});
const LegacyRowSchema = z.strictObject({
  seq: z.number().int().positive(), review_id: IdSchema, created_at_utc: z.string(),
  domain_id: z.enum(["network", "terraform"]), source_id: IdSchema, input_id: IdSchema,
  receipt_id: IdSchema, receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/), record_json: z.string(),
});
type PendingRow = z.infer<typeof PendingRowSchema>;
type ResolutionRow = z.infer<typeof ResolutionRowSchema>;
type DecisionClaimRow = z.infer<typeof DecisionClaimRowSchema>;
type LegacyRow = z.infer<typeof LegacyRowSchema>;
const MigrationPendingRowSchema = z.strictObject({
  seq: z.number().int(),
  review_id: z.string(),
  created_at_utc: z.string(),
  domain_id: z.string(),
  source_id: z.string(),
  input_id: z.string(),
  record_json: z.string(),
});
const MigrationResolutionRowSchema = z.strictObject({
  seq: z.number().int(),
  review_id: z.string(),
  resolved_at_utc: z.string(),
  receipt_id: z.string(),
  receipt_sha256: z.string(),
  resolution_json: z.string(),
});
type OwnerlessPendingRow = z.infer<typeof MigrationPendingRowSchema>;
type OwnerlessResolutionRow = z.infer<typeof MigrationResolutionRowSchema>;
const MigrationOwnerfulPendingRowSchema = MigrationPendingRowSchema.extend({
  owner_tenant_id: z.string(),
  owner_issuer: z.string(),
  owner_subject: z.string(),
  owner_scope: z.string(),
});
const MigrationOwnerfulResolutionRowSchema = MigrationResolutionRowSchema.extend({
  owner_tenant_id: z.string(),
  owner_issuer: z.string(),
  owner_subject: z.string(),
  owner_scope: z.string(),
});
const QuarantineRowSchema = z.strictObject({
  quarantine_id: z.number().int().positive(),
  row_kind: z.enum(["pending", "resolution"]),
  old_seq: z.number().int(),
  review_id: z.string(),
  row_json: z.string(),
  reason: z.string(),
  migration_version: z.string(),
  source_schema_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  row_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export interface DurableReviewStoreEntry {
  seq: number; reviewId: string; createdAtUtc: string; domainId: "network" | "terraform";
  sourceId: string; inputId: string; record: PendingDurableReviewRecord;
}
export interface DurableReviewResolutionEntry {
  seq: number; reviewId: string; resolvedAtUtc: string; receiptId: string; receiptSha256: string;
  resolution: DurableReviewResolution;
}
export interface DurableReviewDecisionClaimEntry {
  seq: number;
  reviewId: string;
  decision: "approve" | "reject";
  claimedAtUtc: string;
  receiptId: string;
  claim: DurableReviewDecisionClaim;
}
/** Read-only compatibility surface for resolved v1 rows. They are not queue items. */
export interface LegacyDurableReviewStoreEntry {
  seq: number; reviewId: string; createdAtUtc: string; domainId: "network" | "terraform";
  sourceId: string; inputId: string; receiptId: string; receiptSha256: string; record: DurableReviewRecord;
}
export interface DurableReviewStoreListOptions { limit?: number; domainId?: "network" | "terraform"; sourceId?: string; }
export interface DurableReviewQuarantineEntry {
  quarantineId: number;
  rowKind: "pending" | "resolution";
  oldSeq: number;
  reviewId: string;
  rowJson: string;
  reason: string;
  migrationVersion: string;
  sourceSchemaFingerprint: string;
  rowSha256: string;
}
export interface DurableReviewQuarantineVerification {
  /** Internal envelope consistency only; this is not an origin/authorship proof. */
  valid: boolean;
  entryCount: number;
  errors: readonly string[];
}
export interface DurableReviewStoreOpenOptions {
  /** Deterministic test seam proving schema changes roll back atomically. */
  migrationFaultInjection?: "after-trigger-installation";
}
const ListOptionsSchema = z.strictObject({ limit: z.number().finite().optional(), domainId: z.enum(["network", "terraform"]).optional(), sourceId: IdSchema.optional() });
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 1000;

// `durable_review_records` is v1 compatibility data. Do not rewrite it into a
// pending item: it represents an already-resolved historical record, and its
// receipt is not evidence that a new v2 resolution was appended.
const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS durable_review_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL,
  domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL
);
`;

// V1 shipped these lookup indexes before the pending/resolution split.  Keep
// them in the normalized compatibility schema so an exact historical V1
// database can be upgraded without discarding its read-path shape.
const LEGACY_INDEX_SCHEMA = `
CREATE INDEX IF NOT EXISTS durable_review_records_created
  ON durable_review_records (created_at_utc);
CREATE INDEX IF NOT EXISTS durable_review_records_domain
  ON durable_review_records (domain_id);
CREATE INDEX IF NOT EXISTS durable_review_records_source
  ON durable_review_records (source_id);
CREATE UNIQUE INDEX IF NOT EXISTS durable_review_records_receipt_id_unique
  ON durable_review_records (receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS durable_review_records_receipt_sha256_unique
  ON durable_review_records (receipt_sha256);
`;

// 436b57b created receipt columns without inline UNIQUE constraints. Later V1
// releases added equivalent named unique indexes, but could not rewrite the
// already-created table SQL. This exact upgraded shape remains supported.
const HISTORICAL_LEGACY_436_SCHEMA = `
CREATE TABLE durable_review_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL UNIQUE, created_at_utc TEXT NOT NULL,
  domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL, receipt_sha256 TEXT NOT NULL, record_json TEXT NOT NULL
);
${LEGACY_INDEX_SCHEMA}
`;

const V2_SCHEMA = `
CREATE TABLE durable_review_pending_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL, created_at_utc TEXT NOT NULL,
  domain_id TEXT NOT NULL, source_id TEXT NOT NULL, input_id TEXT NOT NULL,
  owner_tenant_id TEXT NOT NULL, owner_issuer TEXT NOT NULL, owner_subject TEXT NOT NULL,
  owner_scope TEXT NOT NULL, record_json TEXT NOT NULL,
  UNIQUE (owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id)
);
CREATE TABLE durable_review_resolutions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, review_id TEXT NOT NULL, resolved_at_utc TEXT NOT NULL,
  owner_tenant_id TEXT NOT NULL, owner_issuer TEXT NOT NULL, owner_subject TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE, receipt_sha256 TEXT NOT NULL UNIQUE, resolution_json TEXT NOT NULL,
  UNIQUE (owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id),
  FOREIGN KEY (owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id)
    REFERENCES durable_review_pending_records(owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id)
);
CREATE INDEX durable_review_pending_records_created ON durable_review_pending_records (created_at_utc);
CREATE INDEX durable_review_pending_records_domain ON durable_review_pending_records (domain_id);
CREATE INDEX durable_review_pending_records_source ON durable_review_pending_records (source_id);
CREATE INDEX durable_review_pending_records_owner ON durable_review_pending_records
  (owner_tenant_id, owner_issuer, owner_subject, owner_scope, seq DESC);
`;

const V2_MIGRATION_QUARANTINE_SCHEMA = `
CREATE TABLE durable_review_v2_migration_quarantine (
  quarantine_id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_kind TEXT NOT NULL CHECK (row_kind IN ('pending', 'resolution')),
  old_seq INTEGER NOT NULL,
  review_id TEXT NOT NULL,
  row_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  migration_version TEXT NOT NULL,
  source_schema_fingerprint TEXT NOT NULL,
  row_sha256 TEXT NOT NULL,
  UNIQUE (source_schema_fingerprint, row_kind, old_seq)
);
`;

const DECISION_CLAIM_SCHEMA = `
CREATE TABLE durable_review_decision_claims (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL,
  owner_tenant_id TEXT NOT NULL,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  claimed_at_utc TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  claim_json TEXT NOT NULL,
  UNIQUE (owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id),
  FOREIGN KEY (owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id)
    REFERENCES durable_review_pending_records(owner_tenant_id, owner_issuer, owner_subject, owner_scope, review_id)
);
`;

const HISTORICAL_OWNERLESS_V2_SCHEMA = `
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
`;

const LEGACY_QUARANTINE_SCHEMA = `
CREATE TABLE durable_review_v2_migration_quarantine (
  row_kind TEXT NOT NULL CHECK (row_kind IN ('pending', 'resolution')),
  old_seq INTEGER NOT NULL,
  review_id TEXT NOT NULL,
  row_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (row_kind, old_seq)
);
`;

const MIGRATION_VERSION = "durable-review-owner-quarantine-v2";

const TABLES = [
  {
    table: "durable_review_records",
    conflict: "review_id = NEW.review_id OR receipt_id = NEW.receipt_id OR receipt_sha256 = NEW.receipt_sha256",
  },
  {
    table: "durable_review_pending_records",
    conflict: "(owner_tenant_id = NEW.owner_tenant_id AND owner_issuer = NEW.owner_issuer AND owner_subject = NEW.owner_subject AND owner_scope = NEW.owner_scope AND review_id = NEW.review_id)",
  },
  {
    table: "durable_review_resolutions",
    conflict: "(owner_tenant_id = NEW.owner_tenant_id AND owner_issuer = NEW.owner_issuer AND owner_subject = NEW.owner_subject AND owner_scope = NEW.owner_scope AND review_id = NEW.review_id) OR receipt_id = NEW.receipt_id OR receipt_sha256 = NEW.receipt_sha256",
  },
] as const;

const RESOLUTION_PARENT_BINDING_TRIGGER = "durable_review_resolutions_parent_binding";
const LEGACY_TABLE_NAME = "durable_review_records";
const V2_TABLE_NAMES = ["durable_review_pending_records", "durable_review_resolutions"] as const;
const QUARANTINE_TABLE_NAME = "durable_review_v2_migration_quarantine";
const DECISION_CLAIM_TABLE_NAME = "durable_review_decision_claims";

function triggerSql(table: string, conflict: string): string {
  const names = { update: `${table}_no_update`, delete: `${table}_no_delete`, insert: `${table}_no_conflicting_insert` };
  return `
CREATE TRIGGER ${names.update} BEFORE UPDATE ON ${table} BEGIN
 SELECT RAISE(ABORT, '${table} is append-only: rows cannot be updated'); END;
CREATE TRIGGER ${names.delete} BEFORE DELETE ON ${table} BEGIN
 SELECT RAISE(ABORT, '${table} is append-only: rows cannot be deleted'); END;
CREATE TRIGGER ${names.insert} BEFORE INSERT ON ${table}
WHEN EXISTS (SELECT 1 FROM ${table} WHERE (${conflict}) OR (NEW.seq > 0 AND seq = NEW.seq)) BEGIN
 SELECT RAISE(ABORT, '${table} is append-only: existing bindings cannot be replaced'); END;`;
}

/**
 * Foreign keys are connection-local in SQLite, so this guard duplicates the
 * parent and receipt binding at the schema boundary.  A raw connection with
 * `foreign_keys = OFF` must not be able to create a durable resolution that
 * cannot have come from the server's bound resolution path.
 */
function resolutionParentBindingTriggerSql(bindNetworkProposal = true): string {
  const proposalBinding = bindNetworkProposal
    ? `
      AND (
        pending.domain_id != 'network'
        OR (
          json_extract(NEW.resolution_json, '$.receipt.proposalId') = json_extract(pending.record_json, '$.intake.proposal.proposalId')
          AND json_extract(NEW.resolution_json, '$.receipt.proposalSha256') = json_extract(pending.record_json, '$.intake.proposal.proposalSha256')
        )
      )`
    : "";
  return `
CREATE TRIGGER ${RESOLUTION_PARENT_BINDING_TRIGGER} BEFORE INSERT ON durable_review_resolutions
WHEN NOT json_valid(NEW.resolution_json)
  OR NOT EXISTS (
    SELECT 1 FROM durable_review_pending_records AS pending
    WHERE pending.review_id = NEW.review_id
      AND pending.owner_tenant_id = NEW.owner_tenant_id
      AND pending.owner_issuer = NEW.owner_issuer
      AND pending.owner_subject = NEW.owner_subject
      AND pending.owner_scope = NEW.owner_scope
      AND json_valid(pending.record_json)
      AND json_extract(pending.record_json, '$.recordVersion') = '2'
      AND json_extract(pending.record_json, '$.reviewId') = NEW.review_id
      AND json_extract(pending.record_json, '$.owner.tenantId') = NEW.owner_tenant_id
      AND json_extract(pending.record_json, '$.owner.issuer') = NEW.owner_issuer
      AND json_extract(pending.record_json, '$.owner.subject') = NEW.owner_subject
      AND json_extract(pending.record_json, '$.owner.scope') = NEW.owner_scope
      AND json_extract(pending.record_json, '$.session.domainId') = pending.domain_id
      AND json_extract(pending.record_json, '$.intake.domainId') = pending.domain_id
      AND json_extract(pending.record_json, '$.intake.source.sourceId') = pending.source_id
      AND json_extract(pending.record_json, '$.intake.input.inputId') = pending.input_id
      AND json_extract(pending.record_json, '$.session.source') = json_extract(pending.record_json, '$.intake.source.origin')
      AND json_extract(pending.record_json, '$.session.provenance') = json_extract(pending.record_json, '$.intake.source.origin')
      AND json_extract(NEW.resolution_json, '$.resolutionVersion') = '1'
      AND json_extract(NEW.resolution_json, '$.reviewId') = NEW.review_id
      AND json_extract(NEW.resolution_json, '$.resolvedAtUtc') = NEW.resolved_at_utc
      AND json_extract(NEW.resolution_json, '$.receipt.receiptId') = NEW.receipt_id
      AND json_extract(NEW.resolution_json, '$.receipt.receiptSha256') = NEW.receipt_sha256
      AND json_extract(NEW.resolution_json, '$.receipt.sourceId') = json_extract(pending.record_json, '$.intake.source.sourceId')
      AND json_extract(NEW.resolution_json, '$.receipt.inputId') = json_extract(pending.record_json, '$.intake.input.inputId')
      AND json_extract(NEW.resolution_json, '$.receipt.inputSha256') = json_extract(pending.record_json, '$.intake.input.inputSha256')
      AND json_extract(NEW.resolution_json, '$.receipt.policyVersion') = json_extract(pending.record_json, '$.session.policyVersion')
      ${proposalBinding}
  ) BEGIN
  SELECT RAISE(ABORT, 'durable_review_resolutions requires immutable parent binding');
END;`;
}

function historicalTriggerSql(table: "durable_review_pending_records" | "durable_review_resolutions"): string {
  const keys = table === "durable_review_pending_records"
    ? ["review_id"]
    : ["review_id", "receipt_id", "receipt_sha256"];
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

// Exact trigger DDL shipped by the final V1 store.  It is accepted only as a
// complete fingerprint, then replaced transactionally with the current guard
// text and retained lookup indexes.
function historicalLegacyTriggerSql(): string {
  return `
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
CREATE TRIGGER durable_review_records_no_conflicting_insert
BEFORE INSERT ON durable_review_records
WHEN EXISTS (
  SELECT 1
  FROM durable_review_records
  WHERE review_id = NEW.review_id
     OR receipt_id = NEW.receipt_id
     OR receipt_sha256 = NEW.receipt_sha256
     OR (NEW.seq > 0 AND seq = NEW.seq)
)
BEGIN
  SELECT RAISE(ABORT, 'durable review records are append-only: existing bindings cannot be replaced');
END;`;
}

function historicalResolutionParentBindingTriggerSql(): string {
  return `
CREATE TRIGGER ${RESOLUTION_PARENT_BINDING_TRIGGER} BEFORE INSERT ON durable_review_resolutions
WHEN NOT json_valid(NEW.resolution_json)
  OR NOT EXISTS (
    SELECT 1 FROM durable_review_pending_records AS pending
    WHERE pending.review_id = NEW.review_id
      AND json_valid(pending.record_json)
      AND json_extract(pending.record_json, '$.recordVersion') = '2'
      AND json_extract(pending.record_json, '$.reviewId') = NEW.review_id
      AND json_extract(pending.record_json, '$.session.domainId') = pending.domain_id
      AND json_extract(pending.record_json, '$.intake.domainId') = pending.domain_id
      AND json_extract(pending.record_json, '$.intake.source.sourceId') = pending.source_id
      AND json_extract(pending.record_json, '$.intake.input.inputId') = pending.input_id
      AND json_extract(pending.record_json, '$.session.source') = json_extract(pending.record_json, '$.intake.source.origin')
      AND json_extract(pending.record_json, '$.session.provenance') = json_extract(pending.record_json, '$.intake.source.origin')
      AND json_extract(NEW.resolution_json, '$.resolutionVersion') = '1'
      AND json_extract(NEW.resolution_json, '$.reviewId') = NEW.review_id
      AND json_extract(NEW.resolution_json, '$.resolvedAtUtc') = NEW.resolved_at_utc
      AND json_extract(NEW.resolution_json, '$.receipt.receiptId') = NEW.receipt_id
      AND json_extract(NEW.resolution_json, '$.receipt.receiptSha256') = NEW.receipt_sha256
      AND json_extract(NEW.resolution_json, '$.receipt.sourceId') = json_extract(pending.record_json, '$.intake.source.sourceId')
      AND json_extract(NEW.resolution_json, '$.receipt.inputId') = json_extract(pending.record_json, '$.intake.input.inputId')
      AND json_extract(NEW.resolution_json, '$.receipt.inputSha256') = json_extract(pending.record_json, '$.intake.input.inputSha256')
      AND json_extract(NEW.resolution_json, '$.receipt.policyVersion') = json_extract(pending.record_json, '$.session.policyVersion')
  ) BEGIN
  SELECT RAISE(ABORT, 'durable_review_resolutions requires immutable parent binding');
END;`;
}

function quarantineTriggerSql(): string {
  return `
CREATE TRIGGER durable_review_v2_migration_quarantine_no_update
BEFORE UPDATE ON durable_review_v2_migration_quarantine BEGIN
 SELECT RAISE(ABORT, 'durable review migration quarantine is append-only: rows cannot be updated'); END;
CREATE TRIGGER durable_review_v2_migration_quarantine_no_delete
BEFORE DELETE ON durable_review_v2_migration_quarantine BEGIN
 SELECT RAISE(ABORT, 'durable review migration quarantine is append-only: rows cannot be deleted'); END;
CREATE TRIGGER durable_review_v2_migration_quarantine_no_conflicting_insert
BEFORE INSERT ON durable_review_v2_migration_quarantine
WHEN EXISTS (
  SELECT 1 FROM durable_review_v2_migration_quarantine
  WHERE quarantine_id = NEW.quarantine_id
    OR (
      source_schema_fingerprint = NEW.source_schema_fingerprint
      AND row_kind = NEW.row_kind
      AND old_seq = NEW.old_seq
    )
) BEGIN
 SELECT RAISE(ABORT, 'durable review migration quarantine is append-only: evidence cannot be replaced'); END;`;
}

function decisionClaimTriggerSql(): string {
  return `
CREATE TRIGGER durable_review_decision_claims_no_update
BEFORE UPDATE ON durable_review_decision_claims BEGIN
 SELECT RAISE(ABORT, 'durable review decision claims are append-only: rows cannot be updated'); END;
CREATE TRIGGER durable_review_decision_claims_no_delete
BEFORE DELETE ON durable_review_decision_claims BEGIN
 SELECT RAISE(ABORT, 'durable review decision claims are append-only: rows cannot be deleted'); END;
CREATE TRIGGER durable_review_decision_claims_no_conflicting_insert
BEFORE INSERT ON durable_review_decision_claims
WHEN EXISTS (
  SELECT 1 FROM durable_review_decision_claims
  WHERE (
    owner_tenant_id = NEW.owner_tenant_id
    AND owner_issuer = NEW.owner_issuer
    AND owner_subject = NEW.owner_subject
    AND owner_scope = NEW.owner_scope
    AND review_id = NEW.review_id
  ) OR receipt_id = NEW.receipt_id OR (NEW.seq > 0 AND seq = NEW.seq)
) BEGIN
 SELECT RAISE(ABORT, 'durable review decision claims are append-only: existing bindings cannot be replaced'); END;
CREATE TRIGGER durable_review_decision_claims_parent_binding
BEFORE INSERT ON durable_review_decision_claims
WHEN NOT json_valid(NEW.claim_json)
  OR NOT EXISTS (
    SELECT 1 FROM durable_review_pending_records AS pending
    WHERE pending.review_id = NEW.review_id
      AND pending.owner_tenant_id = NEW.owner_tenant_id
      AND pending.owner_issuer = NEW.owner_issuer
      AND pending.owner_subject = NEW.owner_subject
      AND pending.owner_scope = NEW.owner_scope
      AND json_extract(NEW.claim_json, '$.claimVersion') = '1'
      AND json_extract(NEW.claim_json, '$.reviewId') = NEW.review_id
      AND json_extract(NEW.claim_json, '$.owner.tenantId') = NEW.owner_tenant_id
      AND json_extract(NEW.claim_json, '$.owner.issuer') = NEW.owner_issuer
      AND json_extract(NEW.claim_json, '$.owner.subject') = NEW.owner_subject
      AND json_extract(NEW.claim_json, '$.owner.scope') = NEW.owner_scope
      AND json_extract(NEW.claim_json, '$.decision') = NEW.decision
      AND json_extract(NEW.claim_json, '$.claimedAtUtc') = NEW.claimed_at_utc
      AND json_extract(NEW.claim_json, '$.receiptId') = NEW.receipt_id
  ) BEGIN
 SELECT RAISE(ABORT, 'durable_review_decision_claims requires immutable parent binding');
END;`;
}

const nodeRequire = createRequire(import.meta.url);
function openDatabase(path: string): DatabaseSync { const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); return new sqlite.DatabaseSync(path); }
function normalizeSql(sql: string | null): string | null {
  return sql?.replace(/\s+/g, " ").trim() ?? null;
}

function normalizeTableDefinition(sql: string | null): string | null {
  return normalizeSql(sql)?.replace(/^CREATE TABLE IF NOT EXISTS /i, "CREATE TABLE ") ?? null;
}

function schemaMetadata(db: DatabaseSync, tableNames: readonly string[]): unknown {
  const tableSet = new Set(tableNames);
  const masterRows = z.array(z.strictObject({
    type: z.enum(["table", "index", "trigger"]),
    name: z.string(),
    tbl_name: z.string(),
    sql: z.string().nullable(),
  })).parse(
    db.prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger')
       ORDER BY type, name`,
    ).all(),
  ).filter((row) => tableSet.has(row.tbl_name) && !row.name.startsWith("sqlite_autoindex_"));

  return tableNames.map((table) => {
    const tableSql = masterRows.find((row) => row.type === "table" && row.name === table)?.sql ?? null;
    const indexes = z.array(z.object({
      seq: z.number().int(),
      name: z.string(),
      unique: z.number().int(),
      origin: z.string(),
      partial: z.number().int(),
    }).passthrough()).parse(db.prepare(`PRAGMA index_list(${table})`).all())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((index) => ({
        name: index.name,
        unique: index.unique,
        origin: index.origin,
        partial: index.partial,
        columns: db.prepare("SELECT * FROM pragma_index_xinfo(?)").all(index.name),
      }));
    return {
      table,
      exists: tableSql !== null,
      autoincrement: tableSql ? /\bAUTOINCREMENT\b/i.test(tableSql) : false,
      definition: normalizeTableDefinition(tableSql),
      columns: db.prepare(`PRAGMA table_info(${table})`).all(),
      indexes,
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
      triggers: masterRows
        .filter((row) => row.type === "trigger" && row.tbl_name === table)
        .map((row) => ({ name: row.name, sql: normalizeSql(row.sql) })),
    };
  });
}

function schemaFingerprint(db: DatabaseSync, tableNames: readonly string[]): string {
  return createHash("sha256").update(canonicalize(schemaMetadata(db, tableNames))).digest("hex");
}

function expectedFingerprint(
  schema: string,
  tableNames: readonly string[],
  triggerInstaller?: (db: DatabaseSync) => void,
): string {
  const expected = openDatabase(":memory:");
  try {
    expected.exec(schema);
    triggerInstaller?.(expected);
    return schemaFingerprint(expected, tableNames);
  } finally {
    expected.close();
  }
}

function installHistoricalV2Triggers(db: DatabaseSync): void {
  for (const table of V2_TABLE_NAMES) db.exec(historicalTriggerSql(table));
  db.exec(historicalResolutionParentBindingTriggerSql());
}

function installCurrentLegacyTriggers(db: DatabaseSync): void {
  const legacy = TABLES.find(({ table }) => table === LEGACY_TABLE_NAME);
  if (!legacy) throw new DomainError("INTERNAL", "Durable review legacy trigger configuration is missing.");
  db.exec(triggerSql(legacy.table, legacy.conflict));
}

function installCurrentV2Triggers(db: DatabaseSync, includeQuarantine: boolean): void {
  for (const { table, conflict } of TABLES.filter(({ table }) => table !== LEGACY_TABLE_NAME)) {
    db.exec(triggerSql(table, conflict));
  }
  db.exec(resolutionParentBindingTriggerSql());
  if (includeQuarantine) db.exec(quarantineTriggerSql());
}

function normalizedLegacyFingerprint(): string {
  return expectedFingerprint(`${LEGACY_SCHEMA}${LEGACY_INDEX_SCHEMA}`, [LEGACY_TABLE_NAME], installCurrentLegacyTriggers);
}

function priorCurrentLegacyFingerprint(): string {
  return expectedFingerprint(LEGACY_SCHEMA, [LEGACY_TABLE_NAME], installCurrentLegacyTriggers);
}

function historicalLegacyFingerprint(): string {
  return expectedFingerprint(
    `${LEGACY_SCHEMA}${LEGACY_INDEX_SCHEMA}`,
    [LEGACY_TABLE_NAME],
    (db) => db.exec(historicalLegacyTriggerSql()),
  );
}

function historicalLegacy436Fingerprint(triggerInstaller: (db: DatabaseSync) => void): string {
  return expectedFingerprint(
    HISTORICAL_LEGACY_436_SCHEMA,
    [LEGACY_TABLE_NAME],
    triggerInstaller,
  );
}

function emptyLegacyFingerprint(): string {
  return expectedFingerprint("", [LEGACY_TABLE_NAME]);
}

function currentV2Fingerprint(): string {
  return expectedFingerprint(V2_SCHEMA, V2_TABLE_NAMES, (db) => {
    for (const { table, conflict } of TABLES.filter(({ table }) => table !== "durable_review_records")) {
      db.exec(triggerSql(table, conflict));
    }
    db.exec(resolutionParentBindingTriggerSql());
  });
}

/** Exact owner-scoped V2 schema shipped immediately before proposal binding. */
function priorOwnerfulV2Fingerprint(): string {
  return expectedFingerprint(V2_SCHEMA, V2_TABLE_NAMES, (db) => {
    for (const { table, conflict } of TABLES.filter(({ table }) => table !== "durable_review_records")) {
      db.exec(triggerSql(table, conflict));
    }
    db.exec(resolutionParentBindingTriggerSql(false));
  });
}

function historicalV2Fingerprint(): string {
  return expectedFingerprint(HISTORICAL_OWNERLESS_V2_SCHEMA, V2_TABLE_NAMES, installHistoricalV2Triggers);
}

function currentQuarantineFingerprint(): string {
  return expectedFingerprint(V2_MIGRATION_QUARANTINE_SCHEMA, [QUARANTINE_TABLE_NAME], (db) => {
    db.exec(quarantineTriggerSql());
  });
}

function legacyQuarantineFingerprint(): string {
  return expectedFingerprint(LEGACY_QUARANTINE_SCHEMA, [QUARANTINE_TABLE_NAME]);
}

function emptyV2Fingerprint(): string {
  return expectedFingerprint("", V2_TABLE_NAMES);
}

function emptyQuarantineFingerprint(): string {
  return expectedFingerprint("", [QUARANTINE_TABLE_NAME]);
}

function currentDecisionClaimFingerprint(): string {
  return expectedFingerprint(
    DECISION_CLAIM_SCHEMA,
    [DECISION_CLAIM_TABLE_NAME],
    (db) => db.exec(decisionClaimTriggerSql()),
  );
}

function emptyDecisionClaimFingerprint(): string {
  return expectedFingerprint("", [DECISION_CLAIM_TABLE_NAME]);
}

function dropKnownLegacyTriggers(db: DatabaseSync): void {
  for (const suffix of ["no_update", "no_delete", "no_conflicting_insert"]) {
    db.exec(`DROP TRIGGER IF EXISTS durable_review_records_${suffix}`);
  }
}

function dropKnownLegacyIndexes(db: DatabaseSync): void {
  for (const suffix of [
    "created",
    "domain",
    "source",
    "receipt_id_unique",
    "receipt_sha256_unique",
  ]) {
    db.exec(`DROP INDEX IF EXISTS durable_review_records_${suffix}`);
  }
}

function dropKnownV2Triggers(db: DatabaseSync): void {
  for (const table of ["durable_review_pending_records", "durable_review_resolutions"] as const) {
    for (const suffix of ["no_update", "no_delete", "no_conflicting_insert"]) {
      db.exec(`DROP TRIGGER IF EXISTS ${table}_${suffix}`);
    }
  }
  db.exec(`DROP TRIGGER IF EXISTS ${RESOLUTION_PARENT_BINDING_TRIGGER}`);
}
function dropKnownQuarantineTriggers(db: DatabaseSync): void {
  for (const suffix of ["no_update", "no_delete", "no_conflicting_insert"]) {
    db.exec(`DROP TRIGGER IF EXISTS durable_review_v2_migration_quarantine_${suffix}`);
  }
}

type QuarantineEvidenceEnvelope = Omit<DurableReviewQuarantineEntry, "quarantineId" | "rowSha256">;

function quarantineEnvelopeSha256(envelope: QuarantineEvidenceEnvelope): string {
  return createHash("sha256").update(canonicalize(envelope)).digest("hex");
}

function quarantineRow(
  db: DatabaseSync,
  rowKind: "pending" | "resolution",
  row: OwnerlessPendingRow | OwnerlessResolutionRow,
  reason: string,
  sourceSchemaFingerprint: string,
): void {
  const rowJson = canonicalize(row);
  const rowSha256 = quarantineEnvelopeSha256({
    rowKind,
    oldSeq: row.seq,
    reviewId: row.review_id,
    rowJson,
    reason,
    migrationVersion: MIGRATION_VERSION,
    sourceSchemaFingerprint,
  });
  db.prepare(
    `INSERT INTO durable_review_v2_migration_quarantine
      (row_kind, old_seq, review_id, row_json, reason, migration_version, source_schema_fingerprint, row_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rowKind, row.seq, row.review_id, rowJson, reason, MIGRATION_VERSION, sourceSchemaFingerprint, rowSha256);
}

function setSequenceHighWater(db: DatabaseSync, table: string, highWater: number): void {
  if (highWater <= 0) return;
  db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
  db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, highWater);
}

function rebuildHistoricalLegacy436(db: DatabaseSync): void {
  const duplicateReceiptId = db.prepare(
    "SELECT receipt_id FROM durable_review_records GROUP BY receipt_id HAVING count(*) > 1 LIMIT 1",
  ).get();
  const duplicateReceiptSha = db.prepare(
    "SELECT receipt_sha256 FROM durable_review_records GROUP BY receipt_sha256 HAVING count(*) > 1 LIMIT 1",
  ).get();
  if (duplicateReceiptId || duplicateReceiptSha) {
    throw new DomainError("INTERNAL", "Historical durable review records contain conflicting receipt bindings.");
  }
  const sequenceRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(LEGACY_TABLE_NAME);
  const sequence = sequenceRow
    ? z.strictObject({ seq: z.number().int().nonnegative() }).parse(sequenceRow).seq
    : 0;

  dropKnownLegacyTriggers(db);
  dropKnownLegacyIndexes(db);
  db.exec("ALTER TABLE durable_review_records RENAME TO durable_review_records_pre_constraint_upgrade");
  db.exec(LEGACY_SCHEMA);
  db.exec(
    `INSERT INTO durable_review_records
      (seq, review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json)
     SELECT seq, review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json
       FROM durable_review_records_pre_constraint_upgrade
      ORDER BY seq`,
  );
  db.exec("DROP TABLE durable_review_records_pre_constraint_upgrade");
  setSequenceHighWater(db, LEGACY_TABLE_NAME, sequence);
  db.exec(LEGACY_INDEX_SCHEMA);
  installCurrentLegacyTriggers(db);
}

function rebuildAsQuarantine(
  db: DatabaseSync,
  sourceSchemaFingerprint: string,
  correctiveOwnerfulMigration: boolean,
): void {
  const decisionClaimFingerprint = schemaFingerprint(db, [DECISION_CLAIM_TABLE_NAME]);
  if (decisionClaimFingerprint !== emptyDecisionClaimFingerprint()) {
    if (
      decisionClaimFingerprint !== currentDecisionClaimFingerprint() ||
      z.strictObject({ count: z.number().int().nonnegative() }).parse(
        db.prepare("SELECT count(*) AS count FROM durable_review_decision_claims").get(),
      ).count !== 0
    ) {
      throw new DomainError(
        "INTERNAL",
        "Durable review ownership migration cannot rewrite a non-empty or unknown decision-claim surface.",
      );
    }
    db.exec("DROP TABLE durable_review_decision_claims");
  }
  const pendingRows = db.prepare("SELECT * FROM durable_review_pending_records ORDER BY seq").all()
    .map((row) => correctiveOwnerfulMigration
      ? MigrationOwnerfulPendingRowSchema.parse(row)
      : MigrationPendingRowSchema.parse(row));
  const resolutionRows = db.prepare("SELECT * FROM durable_review_resolutions ORDER BY seq").all()
    .map((row) => correctiveOwnerfulMigration
      ? MigrationOwnerfulResolutionRowSchema.parse(row)
      : MigrationResolutionRowSchema.parse(row));
  const legacyQuarantineRows = correctiveOwnerfulMigration
    ? z.array(z.strictObject({
      row_kind: z.enum(["pending", "resolution"]),
      old_seq: z.number().int(),
      review_id: z.string(),
      row_json: z.string(),
      reason: z.string(),
    })).parse(db.prepare("SELECT * FROM durable_review_v2_migration_quarantine ORDER BY row_kind, old_seq").all())
    : [];

  const pendingHighWater = Math.max(
    0,
    ...pendingRows.map((row) => row.seq),
    ...legacyQuarantineRows.filter((row) => row.row_kind === "pending").map((row) => row.old_seq),
  );
  const resolutionHighWater = Math.max(
    0,
    ...resolutionRows.map((row) => row.seq),
    ...legacyQuarantineRows.filter((row) => row.row_kind === "resolution").map((row) => row.old_seq),
  );

  dropKnownV2Triggers(db);
  for (const index of [
    "durable_review_pending_records_created",
    "durable_review_pending_records_domain",
    "durable_review_pending_records_source",
    "durable_review_pending_records_owner",
  ]) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  db.exec("ALTER TABLE durable_review_pending_records RENAME TO durable_review_pending_records_pre_owner_quarantine");
  db.exec("ALTER TABLE durable_review_resolutions RENAME TO durable_review_resolutions_pre_owner_quarantine");
  if (correctiveOwnerfulMigration) {
    dropKnownQuarantineTriggers(db);
    db.exec("ALTER TABLE durable_review_v2_migration_quarantine RENAME TO durable_review_v2_migration_quarantine_legacy");
  }
  db.exec(V2_SCHEMA);
  db.exec(V2_MIGRATION_QUARANTINE_SCHEMA);

  for (const row of pendingRows) {
    quarantineRow(
      db,
      "pending",
      row,
      correctiveOwnerfulMigration
        ? "corrective-quarantine-of-unattributable-owner-migration"
        : "historical-ownerless-row-has-no-authenticated-owner-binding",
      sourceSchemaFingerprint,
    );
  }
  for (const row of resolutionRows) {
    quarantineRow(
      db,
      "resolution",
      row,
      correctiveOwnerfulMigration
        ? "corrective-quarantine-of-unattributable-owner-migration"
        : "historical-ownerless-row-has-no-authenticated-owner-binding",
      sourceSchemaFingerprint,
    );
  }
  if (correctiveOwnerfulMigration) {
    const historicalFingerprint = historicalV2Fingerprint();
    const insert = db.prepare(
      `INSERT INTO durable_review_v2_migration_quarantine
        (row_kind, old_seq, review_id, row_json, reason, migration_version, source_schema_fingerprint, row_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of legacyQuarantineRows) {
      const reason = `retained-from-prior-quarantine:${row.reason}`;
      const rowSha256 = quarantineEnvelopeSha256({
        rowKind: row.row_kind,
        oldSeq: row.old_seq,
        reviewId: row.review_id,
        rowJson: row.row_json,
        reason,
        migrationVersion: MIGRATION_VERSION,
        sourceSchemaFingerprint: historicalFingerprint,
      });
      insert.run(
        row.row_kind,
        row.old_seq,
        row.review_id,
        row.row_json,
        reason,
        MIGRATION_VERSION,
        historicalFingerprint,
        rowSha256,
      );
    }
  }

  db.exec("DROP TABLE durable_review_resolutions_pre_owner_quarantine");
  db.exec("DROP TABLE durable_review_pending_records_pre_owner_quarantine");
  if (correctiveOwnerfulMigration) {
    db.exec("DROP TABLE durable_review_v2_migration_quarantine_legacy");
  }
  setSequenceHighWater(db, "durable_review_pending_records", pendingHighWater);
  setSequenceHighWater(db, "durable_review_resolutions", resolutionHighWater);
  installCurrentV2Triggers(db, true);
}

function initializeSchema(db: DatabaseSync, options: DurableReviewStoreOpenOptions): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const actualLegacy = schemaFingerprint(db, [LEGACY_TABLE_NAME]);
    const noLegacy = emptyLegacyFingerprint();
    const priorCurrentLegacy = priorCurrentLegacyFingerprint();
    const historicalLegacy = historicalLegacyFingerprint();
    const normalizedLegacy = normalizedLegacyFingerprint();
    const historicalLegacy436 = historicalLegacy436Fingerprint((expected) => {
      expected.exec(historicalLegacyTriggerSql());
    });
    const historicalLegacy436WithCurrentTriggers = historicalLegacy436Fingerprint(installCurrentLegacyTriggers);
    if (
      actualLegacy !== noLegacy &&
      actualLegacy !== priorCurrentLegacy &&
      actualLegacy !== historicalLegacy &&
      actualLegacy !== normalizedLegacy &&
      actualLegacy !== historicalLegacy436 &&
      actualLegacy !== historicalLegacy436WithCurrentTriggers
    ) {
      throw new DomainError("INTERNAL", "Durable review legacy schema fingerprint is unknown or weakened.");
    }
    if (
      actualLegacy === historicalLegacy436 ||
      actualLegacy === historicalLegacy436WithCurrentTriggers
    ) {
      rebuildHistoricalLegacy436(db);
    } else {
      if (actualLegacy === noLegacy) db.exec(LEGACY_SCHEMA);
      dropKnownLegacyTriggers(db);
      db.exec(LEGACY_INDEX_SCHEMA);
      installCurrentLegacyTriggers(db);
    }

    const actualV2 = schemaFingerprint(db, V2_TABLE_NAMES);
    const actualQuarantine = schemaFingerprint(db, [QUARANTINE_TABLE_NAME]);
    const currentV2 = currentV2Fingerprint();
    const priorOwnerfulV2 = priorOwnerfulV2Fingerprint();
    const historicalV2 = historicalV2Fingerprint();
    const emptyV2 = emptyV2Fingerprint();
    const currentQuarantine = currentQuarantineFingerprint();
    const oldQuarantine = legacyQuarantineFingerprint();
    const noQuarantine = emptyQuarantineFingerprint();

    if (actualV2 === emptyV2) {
      if (actualQuarantine !== noQuarantine) {
        throw new DomainError("INTERNAL", "Durable review quarantine exists without its exact owning schema.");
      }
      db.exec(V2_SCHEMA);
      installCurrentV2Triggers(db, false);
    } else if (actualV2 === historicalV2) {
      if (actualQuarantine !== noQuarantine) {
        throw new DomainError("INTERNAL", "Historical durable review schema has an unexpected quarantine surface.");
      }
      rebuildAsQuarantine(db, historicalV2, false);
    } else if (actualV2 === currentV2 || actualV2 === priorOwnerfulV2) {
      if (actualQuarantine === oldQuarantine) {
        rebuildAsQuarantine(db, actualV2, true);
      } else if (actualQuarantine !== noQuarantine && actualQuarantine !== currentQuarantine) {
        throw new DomainError("INTERNAL", "Durable review quarantine schema fingerprint is unknown or weakened.");
      } else if (actualV2 === priorOwnerfulV2) {
        dropKnownV2Triggers(db);
        installCurrentV2Triggers(db, actualQuarantine === currentQuarantine);
      }
    } else {
      throw new DomainError("INTERNAL", "Durable review schema fingerprint is unknown or weakened.");
    }

    const actualDecisionClaims = schemaFingerprint(db, [DECISION_CLAIM_TABLE_NAME]);
    const noDecisionClaims = emptyDecisionClaimFingerprint();
    const currentDecisionClaims = currentDecisionClaimFingerprint();
    if (actualDecisionClaims === noDecisionClaims) {
      db.exec(DECISION_CLAIM_SCHEMA);
      db.exec(decisionClaimTriggerSql());
    } else if (actualDecisionClaims !== currentDecisionClaims) {
      throw new DomainError(
        "INTERNAL",
        "Durable review decision-claim schema fingerprint is unknown or weakened.",
      );
    }

    if (options.migrationFaultInjection === "after-trigger-installation") {
      throw new DomainError("INTERNAL", "Injected durable review migration failure.");
    }
    if (schemaFingerprint(db, V2_TABLE_NAMES) !== currentV2) {
      throw new DomainError("INTERNAL", "Durable review migration did not install the exact current schema.");
    }
    if (schemaFingerprint(db, [LEGACY_TABLE_NAME]) !== normalizedLegacy) {
      throw new DomainError("INTERNAL", "Durable review migration did not install the exact normalized legacy schema.");
    }
    if (schemaFingerprint(db, [DECISION_CLAIM_TABLE_NAME]) !== currentDecisionClaims) {
      throw new DomainError(
        "INTERNAL",
        "Durable review migration did not install the exact decision-claim schema.",
      );
    }
    const finalQuarantine = schemaFingerprint(db, [QUARANTINE_TABLE_NAME]);
    if (finalQuarantine !== noQuarantine && finalQuarantine !== currentQuarantine) {
      throw new DomainError("INTERNAL", "Durable review migration did not install the exact quarantine schema.");
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new DomainError("INTERNAL", "Durable review migration failed foreign-key validation.");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function ownerValues(owner: DurableReviewOwner): [string, string, string, string] {
  const valid = DurableReviewOwnerSchema.parse(owner);
  return [valid.tenantId, valid.issuer, valid.subject, valid.scope];
}
function pendingEntry(row: PendingRow): DurableReviewStoreEntry {
  const record = PendingDurableReviewRecordSchema.parse(JSON.parse(row.record_json));
  const rowOwner = DurableReviewOwnerSchema.parse({
    tenantId: row.owner_tenant_id,
    issuer: row.owner_issuer,
    subject: row.owner_subject,
    scope: row.owner_scope,
  });
  if (
    row.review_id !== record.reviewId ||
    row.created_at_utc !== record.createdAtUtc ||
    row.domain_id !== record.intake.domainId ||
    row.source_id !== record.intake.source.sourceId ||
    row.input_id !== record.intake.input.inputId ||
    canonicalize(rowOwner) !== canonicalize(record.owner)
  ) {
    throw new DomainError("REQUEST_INVALID", "Stored durable review columns do not bind to its immutable record.");
  }
  return { seq: row.seq, reviewId: row.review_id, createdAtUtc: row.created_at_utc, domainId: row.domain_id, sourceId: row.source_id, inputId: row.input_id, record };
}
function resolutionEntry(row: ResolutionRow, pending: PendingDurableReviewRecord): DurableReviewResolutionEntry {
  const resolution = DurableReviewResolutionSchema.parse(JSON.parse(row.resolution_json));
  if (
    resolution.reviewId !== row.review_id ||
    resolution.resolvedAtUtc !== row.resolved_at_utc ||
    resolution.receipt.receiptId !== row.receipt_id ||
    resolution.receipt.receiptSha256 !== row.receipt_sha256 ||
    canonicalize(pending.owner) !== canonicalize(DurableReviewOwnerSchema.parse({
      tenantId: row.owner_tenant_id,
      issuer: row.owner_issuer,
      subject: row.owner_subject,
      scope: row.owner_scope,
    }))
  ) throw new DomainError("REQUEST_INVALID", "Stored durable resolution columns do not bind to its immutable resolution.");
  try { bindServerResolutionToPendingReview(pending, resolution); }
  catch (error) { throw new DomainError("REQUEST_INVALID", `Stored durable resolution does not bind to its immutable parent: ${error instanceof Error ? error.message : "invalid binding"}`); }
  return { seq: row.seq, reviewId: row.review_id, resolvedAtUtc: row.resolved_at_utc, receiptId: row.receipt_id, receiptSha256: row.receipt_sha256, resolution };
}
function decisionClaimEntry(
  row: DecisionClaimRow,
  pending: PendingDurableReviewRecord,
): DurableReviewDecisionClaimEntry {
  const claim = DurableReviewDecisionClaimSchema.parse(JSON.parse(row.claim_json));
  const rowOwner = DurableReviewOwnerSchema.parse({
    tenantId: row.owner_tenant_id,
    issuer: row.owner_issuer,
    subject: row.owner_subject,
    scope: row.owner_scope,
  });
  if (
    claim.reviewId !== row.review_id ||
    canonicalize(claim.owner) !== canonicalize(rowOwner) ||
    canonicalize(claim.owner) !== canonicalize(pending.owner) ||
    claim.decision !== row.decision ||
    claim.claimedAtUtc !== row.claimed_at_utc ||
    claim.receiptId !== row.receipt_id
  ) {
    throw new DomainError(
      "REQUEST_INVALID",
      "Stored durable decision claim columns do not bind to its immutable claim.",
    );
  }
  return {
    seq: row.seq,
    reviewId: row.review_id,
    decision: row.decision,
    claimedAtUtc: row.claimed_at_utc,
    receiptId: row.receipt_id,
    claim,
  };
}
function legacyEntry(row: LegacyRow): LegacyDurableReviewStoreEntry { return { seq: row.seq, reviewId: row.review_id, createdAtUtc: row.created_at_utc, domainId: row.domain_id, sourceId: row.source_id, inputId: row.input_id, receiptId: row.receipt_id, receiptSha256: row.receipt_sha256, record: DurableReviewRecordSchema.parse(JSON.parse(row.record_json)) }; }
function limitOf(raw: number | undefined): number { return Math.min(Math.max(Math.trunc(raw ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT); }
function samePendingRequest(left: PendingDurableReviewRecord, right: PendingDurableReviewRecord): boolean {
  const requestFields = (record: PendingDurableReviewRecord) => ({
    recordVersion: record.recordVersion,
    reviewId: record.reviewId,
    owner: record.owner,
    session: record.session,
    intake: record.intake,
    storage: record.storage,
  });
  return canonicalize(requestFields(left)) === canonicalize(requestFields(right));
}

export class DurableReviewStore {
  readonly #db: DatabaseSync;
  #writes: Promise<void> = Promise.resolve();
  private constructor(db: DatabaseSync) { this.#db = db; }
  static open(path: string, options: DurableReviewStoreOpenOptions = {}): DurableReviewStore {
    const db = openDatabase(path);
    try {
      db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA foreign_keys = ON"); db.exec("PRAGMA recursive_triggers = ON"); db.exec("PRAGMA busy_timeout = 5000");
      initializeSchema(db, options);
      return new DurableReviewStore(db);
    } catch (error) {
      db.close();
      throw error;
    }
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
    const existing = this.get(record.reviewId, record.owner);
    if (existing) { if (samePendingRequest(existing.record, record)) return existing; throw new DomainError("REQUEST_INVALID", `Review ${record.reviewId} already records different immutable metadata.`); }
    try {
      this.#db.prepare("INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, owner_tenant_id, owner_issuer, owner_subject, owner_scope, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        record.reviewId, record.createdAtUtc, record.intake.domainId, record.intake.source.sourceId,
        record.intake.input.inputId, ...ownerValues(record.owner), canonicalize(record),
      );
    }
    catch (error) { const raced = this.get(record.reviewId, record.owner); if (raced) { if (samePendingRequest(raced.record, record)) return raced; throw new DomainError("REQUEST_INVALID", `Review ${record.reviewId} already records different immutable metadata.`); } throw error; }
    const inserted = this.get(record.reviewId, record.owner); if (!inserted) throw new DomainError("INTERNAL", "The review store accepted a pending record but could not read it back."); return inserted;
  }

  /** Append a receipt binding only after the server has recomputed its verdict. */
  async bindServerResolution(reviewId: string, owner: DurableReviewOwner, raw: unknown): Promise<DurableReviewResolutionEntry> {
    const pending = this.get(reviewId, owner); if (!pending) throw new DomainError("REQUEST_INVALID", `No pending durable review exists for ${reviewId}.`);
    const accepted = bindServerResolutionToPendingReview(pending.record, raw);
    return this.#queue(() => this.#appendResolution(pending.record, accepted));
  }

  /**
   * Claim and complete the audit-first decision sequence across every process
   * sharing this review database.
   *
   * The immutable claim is appended before receipt issuance. Its stable
   * receipt identity makes retries idempotent at the ledger boundary: a crash
   * before ledger append can retry the same record, while a crash after ledger
   * append can reconcile that exact record and append only the missing review
   * resolution. Conflicting human intent can never replace the first claim.
   */
  async resolvePending<T>(
    reviewId: string,
    owner: DurableReviewOwner,
    request: {
      decision: "approve" | "reject";
      claimedAtUtc: string;
      approverEmail: string | null;
    },
    issue: (
      pending: PendingDurableReviewRecord,
      claim: DurableReviewDecisionClaim,
    ) => Promise<{ outcome: T; resolution: unknown }>,
  ): Promise<{ outcome: T; resolution: DurableReviewResolutionEntry }> {
    const id = IdSchema.parse(reviewId);
    const validOwner = DurableReviewOwnerSchema.parse(owner);
    const pending = this.get(id, validOwner);
    if (!pending) {
      throw new DomainError("REQUEST_INVALID", `No pending durable review exists for ${id}.`);
    }
    const claim = this.#claimDecision(
      pending.record,
      request.decision,
      request.claimedAtUtc,
      request.approverEmail,
    );
    const issued = await issue(pending.record, claim.claim);
    const accepted = bindServerResolutionToPendingReview(
      pending.record,
      issued.resolution,
    );
    return {
      outcome: issued.outcome,
      resolution: await this.#queue(() => this.#appendResolution(pending.record, accepted)),
    };
  }
  #claimDecision(
    pending: PendingDurableReviewRecord,
    decision: "approve" | "reject",
    claimedAtUtc: string,
    approverEmail: string | null,
  ): DurableReviewDecisionClaimEntry {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.get(pending.reviewId, pending.owner)) {
        throw new DomainError(
          "REQUEST_INVALID",
          `No pending durable review exists for ${pending.reviewId}.`,
        );
      }
      if (this.getResolution(pending.reviewId, pending.owner)) {
        throw new DomainError(
          "ILLEGAL_TRANSITION",
          `Review ${pending.reviewId} already has an immutable resolution.`,
        );
      }
      const existing = this.getDecisionClaim(pending.reviewId, pending.owner);
      if (existing) {
        if (existing.decision !== decision) {
          throw new DomainError(
            "ILLEGAL_TRANSITION",
            `Review ${pending.reviewId} already has a conflicting immutable decision claim.`,
          );
        }
        this.#db.exec("COMMIT");
        return existing;
      }
      const claim = DurableReviewDecisionClaimSchema.parse({
        claimVersion: "1",
        reviewId: pending.reviewId,
        owner: pending.owner,
        approverEmail,
        decision,
        claimedAtUtc,
        receiptId: `rcpt-${randomUUID()}`,
        receiptCreatedAtUtc: claimedAtUtc,
        receiptSignedAtUtc: claimedAtUtc,
      });
      this.#db.prepare(
        `INSERT INTO durable_review_decision_claims
          (review_id, owner_tenant_id, owner_issuer, owner_subject, owner_scope,
           decision, claimed_at_utc, receipt_id, claim_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        claim.reviewId,
        ...ownerValues(claim.owner),
        claim.decision,
        claim.claimedAtUtc,
        claim.receiptId,
        canonicalize(claim),
      );
      const inserted = this.getDecisionClaim(pending.reviewId, pending.owner);
      if (!inserted) {
        throw new DomainError(
          "INTERNAL",
          "The review store accepted a decision claim but could not read it back.",
        );
      }
      this.#db.exec("COMMIT");
      return inserted;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #appendResolution(pending: PendingDurableReviewRecord, resolution: DurableReviewResolution): DurableReviewResolutionEntry {
    const existing = this.getResolution(pending.reviewId, pending.owner);
    if (existing) { if (canonicalize(existing.resolution) === canonicalize(resolution)) return existing; throw new DomainError("ILLEGAL_TRANSITION", `Review ${pending.reviewId} already records a different immutable resolution.`); }
    try { this.#db.prepare("INSERT INTO durable_review_resolutions (review_id, resolved_at_utc, owner_tenant_id, owner_issuer, owner_subject, owner_scope, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(resolution.reviewId, resolution.resolvedAtUtc, ...ownerValues(pending.owner), resolution.receipt.receiptId, resolution.receipt.receiptSha256, canonicalize(resolution)); }
    catch (error) {
      const raced = this.getResolution(pending.reviewId, pending.owner); if (raced) { if (canonicalize(raced.resolution) === canonicalize(resolution)) return raced; throw new DomainError("ILLEGAL_TRANSITION", `Review ${pending.reviewId} already records a different immutable resolution.`); }
      const collision = this.#db.prepare("SELECT review_id FROM durable_review_resolutions WHERE receipt_id = ? OR receipt_sha256 = ? LIMIT 1").get(resolution.receipt.receiptId, resolution.receipt.receiptSha256);
      if (collision) throw new DomainError("REQUEST_INVALID", `Receipt ${resolution.receipt.receiptId} or its content hash is already bound to review ${z.strictObject({ review_id: IdSchema }).parse(collision).review_id}.`);
      throw error;
    }
    const inserted = this.getResolution(pending.reviewId, pending.owner); if (!inserted) throw new DomainError("INTERNAL", "The review store accepted a resolution but could not read it back."); return inserted;
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
  #queue<T>(task: () => T | Promise<T>): Promise<T> { const result = this.#writes.then(task, task); this.#writes = result.then(() => undefined, () => undefined); return result; }
  /**
   * An owner-scoped read deliberately returns null for another principal's
   * review.  HTTP maps that to the same 404 as a missing id, so review ids do
   * not become an enumeration oracle.
   */
  get(reviewId: string, owner: DurableReviewOwner): DurableReviewStoreEntry | null {
    const row = this.#db.prepare("SELECT * FROM durable_review_pending_records WHERE review_id = ? AND owner_tenant_id = ? AND owner_issuer = ? AND owner_subject = ? AND owner_scope = ?").get(IdSchema.parse(reviewId), ...ownerValues(owner));
    return row ? pendingEntry(PendingRowSchema.parse(row)) : null;
  }
  getDecisionClaim(
    reviewId: string,
    owner: DurableReviewOwner,
  ): DurableReviewDecisionClaimEntry | null {
    const id = IdSchema.parse(reviewId);
    const validOwner = DurableReviewOwnerSchema.parse(owner);
    const row = this.#db.prepare(
      `SELECT * FROM durable_review_decision_claims
       WHERE review_id = ?
         AND owner_tenant_id = ?
         AND owner_issuer = ?
         AND owner_subject = ?
         AND owner_scope = ?`,
    ).get(id, ...ownerValues(validOwner));
    if (!row) return null;
    const pending = this.get(id, validOwner);
    if (!pending) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored durable decision claim ${id} has no immutable pending parent.`,
      );
    }
    return decisionClaimEntry(DecisionClaimRowSchema.parse(row), pending.record);
  }
  getResolution(reviewId: string, owner: DurableReviewOwner): DurableReviewResolutionEntry | null {
    const id = IdSchema.parse(reviewId); const validOwner = DurableReviewOwnerSchema.parse(owner);
    const row = this.#db.prepare("SELECT * FROM durable_review_resolutions WHERE review_id = ? AND owner_tenant_id = ? AND owner_issuer = ? AND owner_subject = ? AND owner_scope = ?").get(id, ...ownerValues(validOwner));
    if (!row) return null;
    const pending = this.get(id, validOwner);
    if (!pending) throw new DomainError("REQUEST_INVALID", `Stored durable resolution ${id} has no immutable pending parent.`);
    return resolutionEntry(ResolutionRowSchema.parse(row), pending.record);
  }
  getLegacy(reviewId: string): LegacyDurableReviewStoreEntry | null { const row = this.#db.prepare("SELECT * FROM durable_review_records WHERE review_id = ?").get(IdSchema.parse(reviewId)); return row ? legacyEntry(LegacyRowSchema.parse(row)) : null; }
  list(options: DurableReviewStoreListOptions = {}, owner: DurableReviewOwner): DurableReviewStoreEntry[] {
    const valid = ListOptionsSchema.parse(options); const clauses = ["owner_tenant_id = ?", "owner_issuer = ?", "owner_subject = ?", "owner_scope = ?"]; const params: string[] = [...ownerValues(owner)];
    if (valid.domainId) { clauses.push("domain_id = ?"); params.push(valid.domainId); } if (valid.sourceId) { clauses.push("source_id = ?"); params.push(valid.sourceId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db.prepare(`SELECT * FROM durable_review_pending_records ${where} ORDER BY seq DESC LIMIT ${limitOf(valid.limit)}`).all(...params)
      .map((row) => pendingEntry(PendingRowSchema.parse(row)));
  }
  listLegacy(options: DurableReviewStoreListOptions = {}): LegacyDurableReviewStoreEntry[] {
    const valid = ListOptionsSchema.parse(options); const clauses: string[] = []; const params: string[] = [];
    if (valid.domainId) { clauses.push("domain_id = ?"); params.push(valid.domainId); } if (valid.sourceId) { clauses.push("source_id = ?"); params.push(valid.sourceId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db.prepare(`SELECT * FROM durable_review_records ${where} ORDER BY seq DESC LIMIT ${limitOf(valid.limit)}`).all(...params).map((row) => legacyEntry(LegacyRowSchema.parse(row)));
  }

  /**
   * Quarantine hashes bind the complete retained evidence envelope. They
   * provide an internal consistency check only: because this SQLite database
   * has no signed external migration anchor, they do not prove pre-migration
   * origin, authorship, or an authenticated owner.
   */
  listMigrationQuarantine(): DurableReviewQuarantineEntry[] {
    const table = this.#db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(QUARANTINE_TABLE_NAME);
    if (!table) return [];
    return this.#db.prepare(
      "SELECT * FROM durable_review_v2_migration_quarantine ORDER BY quarantine_id",
    ).all().map((raw) => {
      const row = QuarantineRowSchema.parse(raw);
      return {
        quarantineId: row.quarantine_id,
        rowKind: row.row_kind,
        oldSeq: row.old_seq,
        reviewId: row.review_id,
        rowJson: row.row_json,
        reason: row.reason,
        migrationVersion: row.migration_version,
        sourceSchemaFingerprint: row.source_schema_fingerprint,
        rowSha256: row.row_sha256,
      };
    });
  }

  verifyMigrationQuarantine(): DurableReviewQuarantineVerification {
    const errors: string[] = [];
    let entries: DurableReviewQuarantineEntry[] = [];
    try {
      entries = this.listMigrationQuarantine();
    } catch (error) {
      return {
        valid: false,
        entryCount: 0,
        errors: [`Quarantine rows do not match the exact evidence schema: ${error instanceof Error ? error.message : "invalid row"}`],
      };
    }
    const quarantineExists = this.#db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(QUARANTINE_TABLE_NAME);
    if (quarantineExists && schemaFingerprint(this.#db, [QUARANTINE_TABLE_NAME]) !== currentQuarantineFingerprint()) {
      errors.push("Quarantine schema or append-only guards do not match the exact integrity-evidence fingerprint.");
    }
    const allowedFingerprints = new Set([
      historicalV2Fingerprint(),
      priorOwnerfulV2Fingerprint(),
      currentV2Fingerprint(),
    ]);
    for (const entry of entries) {
      try {
        if (canonicalize(JSON.parse(entry.rowJson)) !== entry.rowJson) {
          errors.push(`Quarantine entry ${entry.quarantineId} row_json is not canonical.`);
        }
      } catch {
        errors.push(`Quarantine entry ${entry.quarantineId} row_json is not valid JSON.`);
      }
      const actual = quarantineEnvelopeSha256({
        rowKind: entry.rowKind,
        oldSeq: entry.oldSeq,
        reviewId: entry.reviewId,
        rowJson: entry.rowJson,
        reason: entry.reason,
        migrationVersion: entry.migrationVersion,
        sourceSchemaFingerprint: entry.sourceSchemaFingerprint,
      });
      if (actual !== entry.rowSha256) {
        errors.push(`Quarantine entry ${entry.quarantineId} digest does not match retained row values.`);
      }
      if (entry.migrationVersion !== MIGRATION_VERSION) {
        errors.push(`Quarantine entry ${entry.quarantineId} has an unsupported migration version.`);
      }
      if (!allowedFingerprints.has(entry.sourceSchemaFingerprint)) {
        errors.push(`Quarantine entry ${entry.quarantineId} has an unknown source schema fingerprint.`);
      }
    }
    return { valid: errors.length === 0, entryCount: entries.length, errors };
  }
}
