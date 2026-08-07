import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createReceipt,
  generateSigningKeyPair,
  importSigningKeyPair,
  signReceipt,
  type ChangeReceipt,
} from "@changesafe/core";

import { GENESIS_CHAIN_SHA256 } from "../src/chain";
import { Ledger } from "../src/ledger";

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-ledger-"));
  dirs.push(dir);
  return path.join(dir, "ledger.db");
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

let counter = 0;
async function receipt(overrides: Partial<Parameters<typeof createReceipt>[0]> = {}) {
  counter += 1;
  return createReceipt({
    sourceId: "src-test",
    inputId: `inc-test-${String(counter).padStart(3, "0")}`,
    input: { devices: { "rtr-1": { enabled: true } } },
    proposal: {
      proposalId: `prop-test-${String(counter).padStart(3, "0")}`,
      summary: "Shift egress to the healthy uplink",
      diagnosis: {
        likelyCause: "primary uplink degraded",
        confidence: 0.8,
        evidenceIds: ["ev-alert-001"],
        assumptions: [],
      },
      operations: [
        {
          op: "replace",
          path: "/devices/rtr-1/routing/preferences/uplink",
          value: "backup",
          reason: "avoid the degraded path",
          evidenceIds: ["ev-alert-001"],
        },
      ],
      rollbackOperations: [],
      verificationSteps: [],
    },
    appVersion: "test-1.0.0",
    policyVersion: "policies-v0.1.0",
    mode: "offline",
    model: null,
    fixtureProvenance: null,
    findings: [
      {
        policyId: "PATCH_SCHEMA",
        status: "PASS",
        title: "All operations are valid declarative patches",
        explanation: "every path is allowlisted",
        affectedResources: [],
        remediation: null,
      },
    ],
    policyCoverage: { orderedPolicyIds: ["PATCH_SCHEMA"], skippedPolicies: [] },
    riskLevel: "LOW",
    decision: "gate_only",
    simulation: null,
    createdAtUtc: "2026-07-25T11:00:00.000Z",
    receiptId: `rcpt-test-${String(counter).padStart(4, "0")}`,
    ...overrides,
  });
}

describe("append-only ledger", () => {
  it("records a receipt and reads it back intact", async () => {
    const ledger = Ledger.open(tempDb());
    const original = await receipt();

    const entry = await ledger.append(original);
    expect(entry.seq).toBe(1);
    expect(entry.previousChainSha256).toBe(GENESIS_CHAIN_SHA256);
    expect(entry.signatureKeyId).toBeNull();
    expect(entry.record).toEqual(original);

    expect(ledger.get(original.receiptId)?.receiptSha256).toBe(original.receiptSha256);
    expect(ledger.count()).toBe(1);
    ledger.close();
  });

  it("chains entries so each links to the one before it", async () => {
    const ledger = Ledger.open(tempDb());
    const first = await ledger.append(await receipt());
    const second = await ledger.append(await receipt());
    const third = await ledger.append(await receipt());

    expect(second.previousChainSha256).toBe(first.chainSha256);
    expect(third.previousChainSha256).toBe(second.chainSha256);
    expect(ledger.head()).toBe(third.chainSha256);

    const verdict = await ledger.verifyChain();
    expect(verdict.ok).toBe(true);
    expect(verdict.entries).toBe(3);
    expect(verdict.headChainSha256).toBe(third.chainSha256);
    ledger.close();
  });

  it("stores which key signed a record", async () => {
    const ledger = Ledger.open(tempDb());
    const pem = await generateSigningKeyPair();
    const signed = await signReceipt(await receipt(), await importSigningKeyPair(pem.privateKeyPem), {
      signedAtUtc: "2026-07-25T12:00:00.000Z",
    });

    const entry = await ledger.append(signed);
    expect(entry.signatureKeyId).toBe(pem.publicKeyId);
    expect(entry.record).toEqual(signed);
    ledger.close();
  });

  it("refuses to record the same receipt twice", async () => {
    const ledger = Ledger.open(tempDb());
    const only = await receipt();
    await ledger.append(only);
    // Silently succeeding would hide that the caller lost track of whether
    // the decision was already durable.
    await expect(ledger.append(only)).rejects.toThrow(/already in the ledger/);
    expect(ledger.count()).toBe(1);
    ledger.close();
  });

  it("blocks UPDATE and DELETE at the database, not just in application code", async () => {
    const file = tempDb();
    const ledger = Ledger.open(file);
    await ledger.append(await receipt());
    ledger.close();

    // Someone reaching past the library with raw SQL still cannot mutate it.
    const raw = new DatabaseSync(file);
    expect(() => raw.exec("UPDATE receipts SET decision = 'approved'")).toThrow(/append-only/);
    expect(() => raw.exec("DELETE FROM receipts")).toThrow(/append-only/);
    raw.close();

    const reopened = Ledger.open(file);
    expect(reopened.list()[0]?.decision).toBe("gate_only");
    reopened.close();
  });

  it("survives being closed and reopened", async () => {
    const file = tempDb();
    const first = Ledger.open(file);
    const entry = await first.append(await receipt());
    first.close();

    const second = Ledger.open(file);
    expect(second.count()).toBe(1);
    expect(second.head()).toBe(entry.chainSha256);
    expect((await second.verifyChain()).ok).toBe(true);
    second.close();
  });
});

describe("concurrent appends", () => {
  /**
   * The server answers requests concurrently, so two approvers deciding at
   * the same moment both reach `append`. Deciding the next entry spans an
   * await, and without serialization both would build the same link and the
   * second would collide on the sequence number the first just took —
   * turning a legitimate decision into an internal error.
   */
  it("orders simultaneous appends instead of colliding on a sequence number", async () => {
    const ledger = Ledger.open(tempDb());
    const receipts = await Promise.all(Array.from({ length: 12 }, () => receipt()));

    const entries = await Promise.all(receipts.map((record) => ledger.append(record)));

    // Every decision was recorded, exactly once, in an unbroken run.
    expect(entries).toHaveLength(receipts.length);
    expect([...entries].map((entry) => entry.seq).sort((a, b) => a - b)).toEqual(
      receipts.map((_, index) => index + 1),
    );
    expect(new Set(entries.map((entry) => entry.chainSha256)).size).toBe(receipts.length);
    expect(ledger.count()).toBe(receipts.length);

    const verdict = await ledger.verifyChain();
    expect(verdict.ok).toBe(true);
    expect(verdict.breaks).toEqual([]);
    ledger.close();
  });

  it("keeps serving later appends after one of them is rejected", async () => {
    const ledger = Ledger.open(tempDb());
    const duplicated = await receipt();
    await ledger.append(duplicated);

    // Built before the calls: awaiting between them would leave the first
    // rejection briefly unhandled, which is a property of this test rather
    // than of the ledger.
    const fresh = await Promise.all([receipt(), receipt()]);
    const results = await Promise.allSettled([
      ledger.append(duplicated), // rejected: already recorded
      ...fresh.map((record) => ledger.append(record)),
    ]);

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
    expect(results[2]?.status).toBe("fulfilled");
    expect(ledger.count()).toBe(3);
    expect((await ledger.verifyChain()).ok).toBe(true);
    ledger.close();
  });
});

describe("tamper evidence", () => {
  /** Drop the guard triggers, simulating someone who owns the file. */
  function unguard(file: string): DatabaseSync {
    const raw = new DatabaseSync(file);
    raw.exec("DROP TRIGGER receipts_no_update");
    raw.exec("DROP TRIGGER receipts_no_delete");
    return raw;
  }

  it("detects an entry deleted straight out of the file", async () => {
    const file = tempDb();
    const ledger = Ledger.open(file);
    await ledger.append(await receipt());
    const second = await ledger.append(await receipt());
    await ledger.append(await receipt());
    ledger.close();

    // The case a plain receipts table cannot see: after this the remaining
    // rows are individually perfect, and the record simply is not there.
    const raw = unguard(file);
    raw.exec(`DELETE FROM receipts WHERE seq = ${second.seq}`);
    raw.close();

    const reopened = Ledger.open(file);
    const verdict = await reopened.verifyChain();
    expect(verdict.ok).toBe(false);
    expect(verdict.entries).toBe(2);
    expect(verdict.breaks.some((b) => /removed or reordered/.test(b.reason))).toBe(true);
    reopened.close();
  });

  it("detects an edited receipt even when its row looks well formed", async () => {
    const file = tempDb();
    const ledger = Ledger.open(file);
    const entry = await ledger.append(await receipt());
    ledger.close();

    const edited: ChangeReceipt = { ...(entry.record as ChangeReceipt), riskLevel: "CRITICAL" };
    const raw = unguard(file);
    raw
      .prepare("UPDATE receipts SET record_json = ? WHERE seq = ?")
      .run(JSON.stringify(edited), entry.seq);
    raw.close();

    const reopened = Ledger.open(file);
    const verdict = await reopened.verifyChain();
    expect(verdict.ok).toBe(false);
    expect(verdict.breaks.some((b) => /does not match its own receiptSha256/.test(b.reason))).toBe(true);
    reopened.close();
  });

  it("detects a rewritten chain digest", async () => {
    const file = tempDb();
    const ledger = Ledger.open(file);
    const entry = await ledger.append(await receipt());
    ledger.close();

    const raw = unguard(file);
    raw.prepare("UPDATE receipts SET chain_sha256 = ? WHERE seq = ?").run("f".repeat(64), entry.seq);
    raw.close();

    const reopened = Ledger.open(file);
    const verdict = await reopened.verifyChain();
    expect(verdict.ok).toBe(false);
    expect(verdict.breaks.some((b) => /does not match this entry/.test(b.reason))).toBe(true);
    reopened.close();
  });

  it("reports a clean chain for an empty ledger rather than failing", async () => {
    const ledger = Ledger.open(tempDb());
    const verdict = await ledger.verifyChain();
    expect(verdict.ok).toBe(true);
    expect(verdict.entries).toBe(0);
    expect(verdict.headChainSha256).toBeNull();
    expect(ledger.head()).toBe(GENESIS_CHAIN_SHA256);
    ledger.close();
  });
});

describe("querying", () => {
  it("filters by source and decision, newest first", async () => {
    const ledger = Ledger.open(tempDb());
    await ledger.append(await receipt({ sourceId: "src-alpha" }));
    await ledger.append(await receipt({ sourceId: "src-beta", decision: "blocked" }));
    await ledger.append(await receipt({ sourceId: "src-alpha" }));

    expect(ledger.list({ sourceId: "src-alpha" })).toHaveLength(2);
    expect(ledger.list({ decision: "blocked" })).toHaveLength(1);
    // Newest first, so an operator sees the most recent decision immediately.
    expect(ledger.list()[0]?.seq).toBe(3);
    expect(ledger.list({ limit: 1 })).toHaveLength(1);
    ledger.close();
  });
});
