import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  generateSigningKeyPair,
  hashCanonical,
  importSigningKeyPair,
} from "@changesafe/core";
import { networkDomain } from "@changesafe/domain-network";
import { Ledger } from "@changesafe/ledger";
import type {
  DurableReviewDecisionClaim,
  PendingDurableReviewRecord,
} from "../../../features/reviews/durable-review-contract";
import { SCENARIOS } from "../../../scenarios";
import { DecisionService } from "../src/decisions";
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
  const proposal = SCENARIOS[0]!.fixture.proposal;
  const inputSha256 = await hashCanonical(content);
  const proposalSha256 = await hashCanonical(proposal);
  return {
    recordVersion: "2", reviewId, createdAtUtc, owner,
    session: { domainId: "network", contractVersion: "2.0.0", policyVersion: "network-policy-v1", domainShape: "simulated-state", capabilities: { sandboxSimulation: true, resourceGraph: true, structuredDiff: true, untrustedContext: true, durableDecision: true }, runtimeMode: "self-hosted", source: "uploaded-offline-artifact", analysisMode: "offline", provenance: "uploaded-offline-artifact" },
    intake: {
      domainId: "network",
      source: { domainId: "network", sourceId, sourceKind: "network-incident-bundle", origin: "uploaded-offline-artifact", untrustedArtifactObservedAtUtc: "2026-07-30T00:00:00.000Z" },
      input: { inputId: "network-input", inputSha256, content },
      proposal: { proposalId: proposal.proposalId, proposalSha256, content: proposal },
    },
    storage: { kind: "append-only-review-store" },
  } as const;
}
async function legacy(reviewId: string) {
  const item = await pending(reviewId);
  const { owner: _owner, ...withoutOwner } = item;
  void _owner;
  const { untrustedArtifactObservedAtUtc, ...historicalSource } = item.intake.source;
  const { proposal: _proposal, ...historicalIntake } = item.intake;
  void _proposal;
  return {
    ...withoutOwner,
    recordVersion: "1",
    intake: {
      ...historicalIntake,
      source: { ...historicalSource, collectedAtUtc: untrustedArtifactObservedAtUtc },
    },
    receipt: { receiptId: `${reviewId}-receipt`, sourceId: item.intake.source.sourceId, inputId: item.intake.input.inputId, inputSha256: item.intake.input.inputSha256, proposalId: `${reviewId}-proposal`, proposalSha256: sha("b"), policyVersion: item.session.policyVersion, receiptSha256: sha("c") },
    storage: { kind: "append-only-ledger" },
  } as const;
}
async function currentLegacy(reviewId: string) {
  const item = await pending(reviewId);
  const { owner: _owner, ...withoutOwner } = item;
  void _owner;
  return {
    ...withoutOwner,
    recordVersion: "1",
    receipt: {
      receiptId: `${reviewId}-receipt`,
      sourceId: item.intake.source.sourceId,
      inputId: item.intake.input.inputId,
      inputSha256: item.intake.input.inputSha256,
      proposalId: item.intake.proposal.proposalId,
      proposalSha256: item.intake.proposal.proposalSha256,
      policyVersion: item.session.policyVersion,
      receiptSha256: sha("c"),
    },
    storage: { kind: "append-only-ledger" },
  } as const;
}
function resolution(reviewId: string, item: Awaited<ReturnType<typeof pending>>, suffix = "one") {
  return { resolutionVersion: "1", reviewId, resolvedAtUtc: "2026-07-30T02:00:00.000Z", receipt: { receiptId: `${reviewId}-receipt-${suffix}`, sourceId: item.intake.source.sourceId, inputId: item.intake.input.inputId, inputSha256: item.intake.input.inputSha256, proposalId: item.intake.proposal.proposalId, proposalSha256: item.intake.proposal.proposalSha256, policyVersion: item.session.policyVersion, receiptSha256: sha(suffix === "one" ? "c" : "d") } } as const;
}

function installExactHistoricalLegacyV1Guards(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX durable_review_records_created
      ON durable_review_records (created_at_utc);
    CREATE INDEX durable_review_records_domain
      ON durable_review_records (domain_id);
    CREATE INDEX durable_review_records_source
      ON durable_review_records (source_id);
    CREATE UNIQUE INDEX durable_review_records_receipt_id_unique
      ON durable_review_records (receipt_id);
    CREATE UNIQUE INDEX durable_review_records_receipt_sha256_unique
      ON durable_review_records (receipt_sha256);
    CREATE TRIGGER durable_review_records_no_update
    BEFORE UPDATE ON durable_review_records
    BEGIN
      SELECT RAISE(ABORT, 'durable review records are append-only: records cannot be updated');
    END;
    CREATE TRIGGER durable_review_records_no_delete
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
    END;
  `);
}

function createExactHistoricalLegacyV1Schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE durable_review_records (
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
  `);
  installExactHistoricalLegacyV1Guards(db);
}

function createExactHistoricalLegacy436Schema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE durable_review_records (
      seq            INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id      TEXT NOT NULL UNIQUE,
      created_at_utc TEXT NOT NULL,
      domain_id      TEXT NOT NULL,
      source_id      TEXT NOT NULL,
      input_id       TEXT NOT NULL,
      receipt_id     TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      record_json    TEXT NOT NULL
    );
  `);
  installExactHistoricalLegacyV1Guards(db);
}

function createHistoricalOwnerlessV2Schema(db: DatabaseSync): void {
  db.exec(`
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
  `);
  installExactHistoricalLegacyV1Guards(db);
}

function installHistoricalOwnerlessV2Triggers(db: DatabaseSync): void {
  db.exec(`
    CREATE TRIGGER durable_review_pending_records_no_update BEFORE UPDATE ON durable_review_pending_records BEGIN
     SELECT RAISE(ABORT, 'durable_review_pending_records is append-only: rows cannot be updated'); END;
    CREATE TRIGGER durable_review_pending_records_no_delete BEFORE DELETE ON durable_review_pending_records BEGIN
     SELECT RAISE(ABORT, 'durable_review_pending_records is append-only: rows cannot be deleted'); END;
    CREATE TRIGGER durable_review_pending_records_no_conflicting_insert BEFORE INSERT ON durable_review_pending_records
    WHEN EXISTS (SELECT 1 FROM durable_review_pending_records WHERE review_id = NEW.review_id OR (NEW.seq > 0 AND seq = NEW.seq)) BEGIN
     SELECT RAISE(ABORT, 'durable_review_pending_records is append-only: existing bindings cannot be replaced'); END;
    CREATE TRIGGER durable_review_resolutions_no_update BEFORE UPDATE ON durable_review_resolutions BEGIN
     SELECT RAISE(ABORT, 'durable_review_resolutions is append-only: rows cannot be updated'); END;
    CREATE TRIGGER durable_review_resolutions_no_delete BEFORE DELETE ON durable_review_resolutions BEGIN
     SELECT RAISE(ABORT, 'durable_review_resolutions is append-only: rows cannot be deleted'); END;
    CREATE TRIGGER durable_review_resolutions_no_conflicting_insert BEFORE INSERT ON durable_review_resolutions
    WHEN EXISTS (SELECT 1 FROM durable_review_resolutions WHERE review_id = NEW.review_id OR receipt_id = NEW.receipt_id OR receipt_sha256 = NEW.receipt_sha256 OR (NEW.seq > 0 AND seq = NEW.seq)) BEGIN
     SELECT RAISE(ABORT, 'durable_review_resolutions is append-only: existing bindings cannot be replaced'); END;
    CREATE TRIGGER durable_review_resolutions_parent_binding BEFORE INSERT ON durable_review_resolutions
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
    END;
  `);
}

function installPriorOwnerfulResolutionBinding(db: DatabaseSync): void {
  db.exec(`
    CREATE TRIGGER durable_review_resolutions_parent_binding BEFORE INSERT ON durable_review_resolutions
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
      ) BEGIN
      SELECT RAISE(ABORT, 'durable_review_resolutions requires immutable parent binding');
    END;
  `);
}

describe("DurableReviewStore v2 pending queue", () => {
  it("upgrades the exact prior owner-scoped proposal-unbound trigger in place", async () => {
    const database = temporaryDatabasePath();
    const item = await pending("prior-ownerful-trigger");
    const first = DurableReviewStore.open(database.path);
    try {
      await first.appendPending(item);
    } finally {
      first.close();
    }

    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const prior = new sqlite.DatabaseSync(database.path);
    try {
      prior.exec("DROP TRIGGER durable_review_resolutions_parent_binding");
      installPriorOwnerfulResolutionBinding(prior);
    } finally {
      prior.close();
    }

    const upgraded = DurableReviewStore.open(database.path);
    try {
      expect(upgraded.get(item.reviewId, aliceOwner)?.record).toEqual(item);
      await expect(
        upgraded.bindServerResolution(
          item.reviewId,
          aliceOwner,
          resolution(item.reviewId, item),
        ),
      ).resolves.toMatchObject({ reviewId: item.reviewId });
    } finally {
      upgraded.close();
    }

    const inspected = new sqlite.DatabaseSync(database.path);
    try {
      const row = z.strictObject({ sql: z.string() }).parse(inspected.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'durable_review_resolutions_parent_binding'",
      ).get());
      expect(row.sql).toContain("$.intake.proposal.proposalSha256");
    } finally {
      inspected.close();
      database.remove();
    }
  });

  it("upgrades the exact trigger-protected V1 store before creating V2 and remains reopenable", async () => {
    const database = temporaryDatabasePath();
    const historical = await legacy("historical-v1-review");
    const current = await pending("current-v2-review");
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createExactHistoricalLegacyV1Schema(raw);
      raw.prepare(
        `INSERT INTO durable_review_records
          (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        historical.reviewId,
        historical.createdAtUtc,
        historical.intake.domainId,
        historical.intake.source.sourceId,
        historical.intake.input.inputId,
        historical.receipt.receiptId,
        historical.receipt.receiptSha256,
        JSON.stringify(historical),
      );
    } finally {
      raw.close();
    }

    const first = DurableReviewStore.open(database.path);
    try {
      expect(first.getLegacy(historical.reviewId)?.record).toEqual(historical);
      await expect(first.appendPending(current)).resolves.toMatchObject({ reviewId: current.reviewId });
    } finally {
      first.close();
    }

    const reopened = DurableReviewStore.open(database.path);
    try {
      expect(reopened.getLegacy(historical.reviewId)?.record).toEqual(historical);
      expect(reopened.get(current.reviewId, aliceOwner)?.record).toEqual(current);
    } finally {
      reopened.close();
    }

    const guarded = new sqlite.DatabaseSync(database.path);
    try {
      const triggerNames = guarded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'durable_review_records' ORDER BY name",
      ).all();
      expect(triggerNames).toEqual([
        { name: "durable_review_records_no_conflicting_insert" },
        { name: "durable_review_records_no_delete" },
        { name: "durable_review_records_no_update" },
      ]);
      expect(() => guarded.prepare(
        "UPDATE durable_review_records SET source_id = 'changed' WHERE review_id = ?",
      ).run(historical.reviewId)).toThrow(/append-only/);
      expect(() => guarded.prepare(
        "DELETE FROM durable_review_records WHERE review_id = ?",
      ).run(historical.reviewId)).toThrow(/append-only/);
      expect(() => guarded.prepare(
        `INSERT OR REPLACE INTO durable_review_records
          (seq, review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        1,
        "replacement-review",
        historical.createdAtUtc,
        historical.intake.domainId,
        "replacement-source",
        historical.intake.input.inputId,
        "replacement-receipt",
        sha("e"),
        JSON.stringify(historical),
      )).toThrow(/append-only/);
    } finally {
      guarded.close();
      database.remove();
    }
  });

  it("rebuilds the exact upgraded 436 V1 table with current receipt constraints", async () => {
    const database = temporaryDatabasePath();
    const historical = await legacy("historical-436-review");
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createExactHistoricalLegacy436Schema(raw);
      raw.prepare(
        `INSERT INTO durable_review_records
          (seq, review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        11,
        historical.reviewId,
        historical.createdAtUtc,
        historical.intake.domainId,
        historical.intake.source.sourceId,
        historical.intake.input.inputId,
        historical.receipt.receiptId,
        historical.receipt.receiptSha256,
        JSON.stringify(historical),
      );
    } finally {
      raw.close();
    }

    const migrated = DurableReviewStore.open(database.path);
    try {
      expect(migrated.getLegacy(historical.reviewId)).toMatchObject({
        seq: 11,
        record: historical,
      });
      const next = await currentLegacy("post-436-review");
      await expect(migrated.append({
        ...next,
        receipt: { ...next.receipt, receiptSha256: sha("d") },
      })).resolves.toMatchObject({
        seq: 12,
      });
    } finally {
      migrated.close();
    }

    const inspected = new sqlite.DatabaseSync(database.path);
    try {
      const table = inspected.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'durable_review_records'",
      ).get();
      expect(table).toMatchObject({
        sql: expect.stringMatching(/receipt_id TEXT NOT NULL UNIQUE.*receipt_sha256 TEXT NOT NULL UNIQUE/s),
      });
      expect(() => inspected.prepare(
        "UPDATE durable_review_records SET source_id = 'changed' WHERE review_id = ?",
      ).run(historical.reviewId)).toThrow(/append-only/);
    } finally {
      inspected.close();
      database.remove();
    }
  });

  it("fails closed when a historical V1 append-only trigger was mutated", () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createExactHistoricalLegacyV1Schema(raw);
      raw.exec(`
        DROP TRIGGER durable_review_records_no_update;
        CREATE TRIGGER durable_review_records_no_update
        BEFORE UPDATE ON durable_review_records BEGIN SELECT 1; END;
      `);
    } finally {
      raw.close();
    }

    expect(() => DurableReviewStore.open(database.path)).toThrow(
      /legacy schema fingerprint is unknown or weakened/,
    );
    database.remove();
  });

  it("accepts a verified receipt-free pending intake exactly once", async () => {
    const store = DurableReviewStore.open(":memory:");
    try { const item = await pending("review-one"); const first = await store.appendPending(item); expect(await store.appendPending(item)).toEqual(first); expect(first).toMatchObject({ seq: 1, reviewId: "review-one" }); expect(store.count()).toBe(1); expect(store.get("review-one", aliceOwner)).toEqual(first); expect(store.getResolution("review-one", aliceOwner)).toBeNull(); } finally { store.close(); }
  });

  it("correlates a racing cross-instance decision to one signed ledger receipt", async () => {
    const database = temporaryDatabasePath();
    const ledgerPath = join(database.path, "..", "ledger.sqlite");
    const first = DurableReviewStore.open(database.path);
    const second = DurableReviewStore.open(database.path);
    const ledger = Ledger.open(ledgerPath);
    try {
      const base = await pending("review-cross-instance-decision");
      const item = {
        ...base,
        session: { ...base.session, policyVersion: networkDomain.policyVersion },
        intake: {
          ...base.intake,
          input: {
            ...base.intake.input,
            inputId: base.intake.input.content.incidentId,
          },
        },
      } as const;
      await first.appendPending(item);
      const pem = await generateSigningKeyPair();
      const decisions = new DecisionService({
        ledger,
        appVersion: "changesafe-server-test",
        signingKeyPair: await importSigningKeyPair(pem.privateKeyPem),
      });
      const issue = async (
        stored: PendingDurableReviewRecord,
        claim: DurableReviewDecisionClaim,
      ) => {
        const outcome = await decisions.decideSigned(
          {
            domain: stored.intake.domainId,
            sourceId: stored.intake.source.sourceId,
            input: stored.intake.input.content,
            proposal: stored.intake.proposal?.content,
            decision: "reject",
          },
          { subject: aliceOwner.subject, issuer: aliceOwner.issuer, email: null },
          {
            expectedPolicyVersion: stored.session.policyVersion,
            receiptId: claim.receiptId,
            receiptCreatedAtUtc: claim.receiptCreatedAtUtc,
            receiptSignedAtUtc: claim.receiptSignedAtUtc,
          },
        );
        return {
          outcome,
          resolution: {
            resolutionVersion: "1",
            reviewId: stored.reviewId,
            resolvedAtUtc: "2026-07-30T02:00:00.000Z",
            receipt: {
              receiptId: outcome.receipt.receiptId,
              sourceId: outcome.receipt.sourceId,
              inputId: outcome.receipt.inputId,
              inputSha256: outcome.receipt.inputSha256,
              proposalId: outcome.receipt.proposalId,
              proposalSha256: outcome.receipt.proposalSha256,
              policyVersion: outcome.receipt.policyVersion,
              receiptSha256: outcome.receipt.receiptSha256,
            },
          },
        } as const;
      };

      const results = await Promise.all([
        first.resolvePending(
          item.reviewId,
          aliceOwner,
          { decision: "reject", claimedAtUtc: "2026-07-30T01:01:00.000Z", approverEmail: null },
          issue,
        ),
        second.resolvePending(
          item.reviewId,
          aliceOwner,
          { decision: "reject", claimedAtUtc: "2026-07-30T01:01:01.000Z", approverEmail: "changed@example.test" },
          issue,
        ),
      ]);

      expect(ledger.count()).toBe(1);
      expect(new Set(results.map(({ outcome }) => outcome.receipt.receiptId)).size).toBe(1);
      expect(first.getDecisionClaim(item.reviewId, aliceOwner)?.receiptId).toBe(
        results[0]!.outcome.receipt.receiptId,
      );
      expect(first.getDecisionClaim(item.reviewId, bobOwner)).toBeNull();
      expect(second.getResolution(item.reviewId, aliceOwner)).not.toBeNull();
      const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
      const raw = new sqlite.DatabaseSync(database.path);
      try {
        expect(() => raw.prepare(
          "UPDATE durable_review_decision_claims SET decision = 'approve' WHERE review_id = ?",
        ).run(item.reviewId)).toThrow(/append-only/);
        expect(() => raw.prepare(
          "DELETE FROM durable_review_decision_claims WHERE review_id = ?",
        ).run(item.reviewId)).toThrow(/append-only/);
      } finally {
        raw.close();
      }

      const crashBase = await pending("review-ledger-before-resolution-crash");
      const crashItem = {
        ...crashBase,
        session: {
          ...crashBase.session,
          policyVersion: networkDomain.policyVersion,
        },
        intake: {
          ...crashBase.intake,
          input: {
            ...crashBase.intake.input,
            inputId: crashBase.intake.input.content.incidentId,
          },
        },
      } as const;
      await first.appendPending(crashItem);
      let ledgeredBeforeCrash: string | null = null;
      await expect(first.resolvePending(
        crashItem.reviewId,
        aliceOwner,
        { decision: "reject", claimedAtUtc: "2026-07-30T02:01:00.000Z", approverEmail: null },
        async (stored, claim) => {
          const issued = await issue(stored, claim);
          ledgeredBeforeCrash = issued.outcome.receipt.receiptId;
          throw new Error("simulated crash after ledger append");
        },
      )).rejects.toThrow(/simulated crash/);
      expect(ledger.count()).toBe(2);
      expect(first.getResolution(crashItem.reviewId, aliceOwner)).toBeNull();

      const recovered = await second.resolvePending(
        crashItem.reviewId,
        aliceOwner,
        { decision: "reject", claimedAtUtc: "2026-07-30T04:00:00.000Z", approverEmail: "changed@example.test" },
        issue,
      );
      expect(ledger.count()).toBe(2);
      expect(recovered.outcome.receipt.receiptId).toBe(ledgeredBeforeCrash);
      expect(second.getResolution(crashItem.reviewId, aliceOwner)).not.toBeNull();
    } finally {
      first.close();
      second.close();
      ledger.close();
      database.remove();
    }
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

  it("quarantines exact b729212 and 8247f70 ownerless rows without inventing ownership", async () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const owned = await pending("owned-old-review");
    const ownedResolution = resolution(owned.reviewId, owned);
    const ownerless = await pending("unowned-old-review", "unowned-source");
    const { owner: _discardedOwner, ...unownedWithCurrentTime } = ownerless;
    void _discardedOwner;
    const {
      untrustedArtifactObservedAtUtc,
      ...ownerlessSourceWithoutObservedTime
    } = unownedWithCurrentTime.intake.source;
    const unownedRecord = {
      ...unownedWithCurrentTime,
      intake: {
        ...unownedWithCurrentTime.intake,
        source: {
          ...ownerlessSourceWithoutObservedTime,
          collectedAtUtc: untrustedArtifactObservedAtUtc,
        },
      },
    };
    const unownedResolution = resolution(ownerless.reviewId, ownerless, "two");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      raw.exec("PRAGMA foreign_keys = ON");
      createHistoricalOwnerlessV2Schema(raw);
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
      installHistoricalOwnerlessV2Triggers(raw);
    } finally {
      raw.close();
    }

    const store = DurableReviewStore.open(database.path);
    try {
      expect(store.count()).toBe(0);
      expect(store.get(owned.reviewId, aliceOwner)).toBeNull();
      expect(store.get(owned.reviewId, bobOwner)).toBeNull();
      expect(store.getResolution(owned.reviewId, aliceOwner)).toBeNull();
      expect(store.getResolution(owned.reviewId, bobOwner)).toBeNull();
      expect(store.get(ownerless.reviewId, aliceOwner)).toBeNull();
      expect(store.verifyMigrationQuarantine()).toEqual({
        valid: true,
        entryCount: 4,
        errors: [],
      });

      const migrated = new sqlite.DatabaseSync(database.path);
      try {
        const quarantine = migrated
          .prepare("SELECT row_kind, review_id, reason, row_json, migration_version, source_schema_fingerprint, row_sha256 FROM durable_review_v2_migration_quarantine ORDER BY row_kind, old_seq")
          .all() as Array<{ row_kind: string; review_id: string; reason: string; row_json: string; migration_version: string; source_schema_fingerprint: string; row_sha256: string }>;
        expect(quarantine.map(({ row_kind, review_id }) => ({ row_kind, review_id }))).toEqual([
          { row_kind: "pending", review_id: owned.reviewId },
          { row_kind: "pending", review_id: ownerless.reviewId },
          { row_kind: "resolution", review_id: owned.reviewId },
          { row_kind: "resolution", review_id: ownerless.reviewId },
        ]);
        expect(quarantine.every((row) => row.reason.includes("no-authenticated-owner-binding"))).toBe(true);
        expect(quarantine.every((row) => row.migration_version === "durable-review-owner-quarantine-v2")).toBe(true);
        expect(new Set(quarantine.map((row) => row.source_schema_fingerprint))).toHaveProperty("size", 1);
        expect(quarantine.map((row) => JSON.parse(row.row_json).record_json ?? JSON.parse(row.row_json).resolution_json))
          .toEqual([
            JSON.stringify(owned),
            JSON.stringify(unownedRecord),
            JSON.stringify(ownedResolution),
            JSON.stringify(unownedResolution),
          ]);
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
        expect(() => migrated.prepare("UPDATE durable_review_v2_migration_quarantine SET reason = 'changed' WHERE quarantine_id = 1").run()).toThrow(/append-only/);
        expect(() => migrated.prepare("DELETE FROM durable_review_v2_migration_quarantine WHERE quarantine_id = 1").run()).toThrow(/append-only/);
        expect(() => migrated.prepare("INSERT OR REPLACE INTO durable_review_v2_migration_quarantine SELECT * FROM durable_review_v2_migration_quarantine WHERE quarantine_id = 1").run()).toThrow(/append-only/);
      } finally {
        migrated.close();
      }
    } finally {
      store.close();
      database.remove();
    }
  });

  it("retains corrupt historical rows as integrity evidence instead of parsing or promoting them", () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createHistoricalOwnerlessV2Schema(raw);
      raw.prepare(
        "INSERT INTO durable_review_pending_records (seq, review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(-9, "corrupt-pending", "not-a-time", "unknown-domain", "source", "input", "{not-json");
      raw.prepare(
        "INSERT INTO durable_review_resolutions (seq, review_id, resolved_at_utc, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(-12, "corrupt-pending", "also-not-a-time", "receipt", "not-a-sha", "{\"wrong\":true}");
      installHistoricalOwnerlessV2Triggers(raw);
    } finally {
      raw.close();
    }

    const store = DurableReviewStore.open(database.path);
    try {
      expect(store.count()).toBe(0);
      const evidence = store.listMigrationQuarantine();
      expect(evidence).toHaveLength(2);
      expect(evidence.map((entry) => ({
        rowKind: entry.rowKind,
        oldSeq: entry.oldSeq,
        retainedPayload: JSON.parse(entry.rowJson).record_json ?? JSON.parse(entry.rowJson).resolution_json,
      }))).toEqual([
        { rowKind: "pending", oldSeq: -9, retainedPayload: "{not-json" },
        { rowKind: "resolution", oldSeq: -12, retainedPayload: "{\"wrong\":true}" },
      ]);
      expect(store.verifyMigrationQuarantine()).toMatchObject({ valid: true, entryCount: 2 });
    } finally {
      store.close();
      database.remove();
    }
  });

  it("rolls back schema data and historical triggers when migration faults after trigger installation", async () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const historical = await pending("rollback-review");
    const raw = new sqlite.DatabaseSync(database.path);
    let beforeSchema: unknown[];
    let beforePending: unknown[];
    try {
      createHistoricalOwnerlessV2Schema(raw);
      raw.prepare(
        "INSERT INTO durable_review_pending_records (seq, review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        17,
        historical.reviewId,
        historical.createdAtUtc,
        historical.intake.domainId,
        historical.intake.source.sourceId,
        historical.intake.input.inputId,
        JSON.stringify(historical),
      );
      installHistoricalOwnerlessV2Triggers(raw);
      beforeSchema = raw.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name IN ('durable_review_pending_records', 'durable_review_resolutions') ORDER BY type, name",
      ).all();
      beforePending = raw.prepare("SELECT * FROM durable_review_pending_records ORDER BY seq").all();
    } finally {
      raw.close();
    }

    expect(() => DurableReviewStore.open(database.path, {
      migrationFaultInjection: "after-trigger-installation",
    })).toThrow(/Injected durable review migration failure/);

    const afterFailure = new sqlite.DatabaseSync(database.path);
    try {
      expect(afterFailure.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name IN ('durable_review_pending_records', 'durable_review_resolutions') ORDER BY type, name",
      ).all()).toEqual(beforeSchema);
      expect(afterFailure.prepare("SELECT * FROM durable_review_pending_records ORDER BY seq").all()).toEqual(beforePending);
      expect(() => afterFailure.prepare(
        "UPDATE durable_review_pending_records SET source_id = 'changed' WHERE review_id = ?",
      ).run(historical.reviewId)).toThrow(/append-only/);
      expect(afterFailure.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'durable_review_v2_migration_quarantine'",
      ).get()).toBeUndefined();
    } finally {
      afterFailure.close();
    }

    const recovered = DurableReviewStore.open(database.path);
    try {
      expect(recovered.count()).toBe(0);
      expect(recovered.verifyMigrationQuarantine()).toMatchObject({ valid: true, entryCount: 1 });
    } finally {
      recovered.close();
      database.remove();
    }
  });

  it("rejects a weakened ownerful schema instead of pretending CREATE IF NOT EXISTS repaired it", () => {
    const database = temporaryDatabasePath();
    const store = DurableReviewStore.open(database.path);
    store.close();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      raw.exec("DROP TRIGGER durable_review_pending_records_no_update");
    } finally {
      raw.close();
    }
    expect(() => DurableReviewStore.open(database.path)).toThrow(/schema fingerprint is unknown or weakened/);
    database.remove();
  });

  it("correctively quarantines ownerful rows from the prior unauthenticated migration signal", async () => {
    const database = temporaryDatabasePath();
    const item = await pending("prior-promoted-review");
    const initial = DurableReviewStore.open(database.path);
    await initial.appendPending(item);
    initial.close();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      raw.exec(`
        CREATE TABLE durable_review_v2_migration_quarantine (
          row_kind TEXT NOT NULL CHECK (row_kind IN ('pending', 'resolution')),
          old_seq INTEGER NOT NULL,
          review_id TEXT NOT NULL,
          row_json TEXT NOT NULL,
          reason TEXT NOT NULL,
          PRIMARY KEY (row_kind, old_seq)
        );
      `);
    } finally {
      raw.close();
    }

    const corrected = DurableReviewStore.open(database.path);
    try {
      expect(corrected.count()).toBe(0);
      expect(corrected.get(item.reviewId, aliceOwner)).toBeNull();
      expect(corrected.listMigrationQuarantine()).toEqual([
        expect.objectContaining({
          rowKind: "pending",
          oldSeq: 1,
          reviewId: item.reviewId,
          reason: "corrective-quarantine-of-unattributable-owner-migration",
        }),
      ]);
      expect(corrected.verifyMigrationQuarantine()).toMatchObject({ valid: true, entryCount: 1 });
    } finally {
      corrected.close();
      database.remove();
    }
  });

  it("preserves historical sequence high-water marks and reopens quarantine idempotently", async () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const historical = await pending("high-water-historical");
    const historicalResolution = resolution(historical.reviewId, historical);
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createHistoricalOwnerlessV2Schema(raw);
      raw.prepare(
        "INSERT INTO durable_review_pending_records (seq, review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        41,
        historical.reviewId,
        historical.createdAtUtc,
        historical.intake.domainId,
        historical.intake.source.sourceId,
        historical.intake.input.inputId,
        JSON.stringify(historical),
      );
      raw.prepare(
        "INSERT INTO durable_review_resolutions (seq, review_id, resolved_at_utc, receipt_id, receipt_sha256, resolution_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        73,
        historicalResolution.reviewId,
        historicalResolution.resolvedAtUtc,
        historicalResolution.receipt.receiptId,
        historicalResolution.receipt.receiptSha256,
        JSON.stringify(historicalResolution),
      );
      installHistoricalOwnerlessV2Triggers(raw);
    } finally {
      raw.close();
    }

    const migrated = DurableReviewStore.open(database.path);
    const firstEvidence = migrated.listMigrationQuarantine();
    migrated.close();
    const reopened = DurableReviewStore.open(database.path);
    try {
      expect(reopened.listMigrationQuarantine()).toEqual(firstEvidence);
      const next = await pending("after-high-water");
      expect((await reopened.appendPending(next)).seq).toBe(42);
      expect((await reopened.bindServerResolution(next.reviewId, aliceOwner, resolution(next.reviewId, next))).seq).toBe(74);
    } finally {
      reopened.close();
      database.remove();
    }
  });

  it("detects quarantine envelope metadata tampering if a hostile connection first removes the guard", async () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const historical = await pending("tamper-evidence");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createHistoricalOwnerlessV2Schema(raw);
      raw.prepare(
        "INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        historical.reviewId,
        historical.createdAtUtc,
        historical.intake.domainId,
        historical.intake.source.sourceId,
        historical.intake.input.inputId,
        JSON.stringify(historical),
      );
      installHistoricalOwnerlessV2Triggers(raw);
    } finally {
      raw.close();
    }
    const store = DurableReviewStore.open(database.path);
    const hostile = new sqlite.DatabaseSync(database.path);
    try {
      hostile.exec("DROP TRIGGER durable_review_v2_migration_quarantine_no_update");
      hostile.prepare(
        "UPDATE durable_review_v2_migration_quarantine SET reason = ? WHERE quarantine_id = 1",
      ).run("tampered-reason");
      expect(store.verifyMigrationQuarantine()).toMatchObject({
        valid: false,
        entryCount: 1,
        errors: expect.arrayContaining([
          expect.stringMatching(/schema or append-only guards/),
          expect.stringMatching(/digest does not match/),
        ]),
      });
    } finally {
      hostile.close();
      store.close();
      database.remove();
    }
  });

  it("rejects verification of a raw fabricated quarantine row carrying only a payload hash", async () => {
    const database = temporaryDatabasePath();
    const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const historical = await pending("fabrication-source");
    const raw = new sqlite.DatabaseSync(database.path);
    try {
      createHistoricalOwnerlessV2Schema(raw);
      raw.prepare(
        "INSERT INTO durable_review_pending_records (review_id, created_at_utc, domain_id, source_id, input_id, record_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        historical.reviewId,
        historical.createdAtUtc,
        historical.intake.domainId,
        historical.intake.source.sourceId,
        historical.intake.input.inputId,
        JSON.stringify(historical),
      );
      installHistoricalOwnerlessV2Triggers(raw);
    } finally {
      raw.close();
    }

    const store = DurableReviewStore.open(database.path);
    const hostile = new sqlite.DatabaseSync(database.path);
    try {
      const existing = store.listMigrationQuarantine()[0]!;
      const fabricatedRowJson = "{\"fabricated\":true}";
      hostile.prepare(
        `INSERT INTO durable_review_v2_migration_quarantine
          (row_kind, old_seq, review_id, row_json, reason, migration_version, source_schema_fingerprint, row_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "pending",
        999,
        "fabricated-review",
        fabricatedRowJson,
        "historical-ownerless-row-has-no-authenticated-owner-binding",
        existing.migrationVersion,
        existing.sourceSchemaFingerprint,
        createHash("sha256").update(fabricatedRowJson).digest("hex"),
      );
      expect(store.verifyMigrationQuarantine()).toMatchObject({
        valid: false,
        entryCount: 2,
        errors: expect.arrayContaining([
          expect.stringMatching(/digest does not match retained row values/),
        ]),
      });
    } finally {
      hostile.close();
      store.close();
      database.remove();
    }
  });

  it("preserves legacy v1 resolved rows on upgrade without presenting them as pending v2 queue work", async () => {
    const database = temporaryDatabasePath(); const sqlite = nodeRequire("node:sqlite") as typeof import("node:sqlite"); const old = await legacy("old-review");
    const raw = new sqlite.DatabaseSync(database.path);
    try { createExactHistoricalLegacyV1Schema(raw); raw.prepare("INSERT INTO durable_review_records (review_id, created_at_utc, domain_id, source_id, input_id, receipt_id, receipt_sha256, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(old.reviewId, old.createdAtUtc, old.intake.domainId, old.intake.source.sourceId, old.intake.input.inputId, old.receipt.receiptId, old.receipt.receiptSha256, JSON.stringify(old)); } finally { raw.close(); }
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
    try { const old = await currentLegacy("legacy-review"); await store.append(old); expect(store.legacyCount()).toBe(1); expect(store.count()).toBe(0); expect(store.get("legacy-review", aliceOwner)).toBeNull(); expect(store.getLegacy("legacy-review")?.record).toEqual(old); } finally { store.close(); }
  });
});
