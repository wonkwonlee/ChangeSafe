import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  signReceipt,
  type ChangeReceipt,
  type SignedReceipt,
} from "@changesafe/core";
import { Ledger, type ChainVerdict, type LedgerEntry } from "@changesafe/ledger";

import type { DurableReviewResolution } from "../../../features/reviews/durable-review-contract";
import { buildReceiptProof, type ReceiptProofLedger } from "../src/receipt-proof";
import { someReceipt } from "./helpers";

const checkedAtUtc = "2026-07-30T06:00:00.000Z";
const chainSha256 = "a".repeat(64);

function resolutionFor(receipt: ChangeReceipt): DurableReviewResolution {
  return {
    resolutionVersion: "1",
    reviewId: "review-proof-one",
    resolvedAtUtc: "2026-07-30T05:30:00.000Z",
    receipt: {
      receiptId: receipt.receiptId,
      sourceId: receipt.sourceId,
      inputId: receipt.inputId,
      inputSha256: receipt.inputSha256,
      proposalId: receipt.proposalId,
      proposalSha256: receipt.proposalSha256,
      policyVersion: receipt.policyVersion,
      receiptSha256: receipt.receiptSha256,
    },
  };
}

function entryFor(record: ChangeReceipt | SignedReceipt): LedgerEntry {
  const receipt = "receipt" in record ? record.receipt : record;
  return {
    seq: 1,
    receiptId: receipt.receiptId,
    createdAtUtc: receipt.createdAtUtc,
    decision: receipt.decision,
    riskLevel: receipt.riskLevel,
    sourceId: receipt.sourceId,
    inputId: receipt.inputId,
    proposalId: receipt.proposalId,
    receiptSha256: receipt.receiptSha256,
    signatureKeyId: "receipt" in record ? record.signature.publicKeyId : null,
    previousChainSha256: "0".repeat(64),
    chainSha256,
    record,
  };
}

function ledgerFor(
  entry: LedgerEntry | null,
  verdict: ChainVerdict = {
    ok: true,
    entries: entry ? 1 : 0,
    headChainSha256: entry ? entry.chainSha256 : null,
    breaks: [],
  },
): ReceiptProofLedger {
  return {
    get: () => entry,
    verifyChain: async () => verdict,
  };
}

async function signedFixture() {
  const receipt = await someReceipt();
  const pem = await generateSigningKeyPair();
  const record = await signReceipt(
    receipt,
    await importSigningKeyPair(pem.privateKeyPem),
    { signedAtUtc: "2026-07-30T05:15:00.000Z" },
  );
  return { receipt, pem, record };
}

describe("durable receipt proof assembly", () => {
  it("keeps a present signature unverified when no out-of-band key is configured", async () => {
    const { receipt, record } = await signedFixture();
    const proof = await buildReceiptProof(resolutionFor(receipt), ledgerFor(entryFor(record)), {
      checkedAtUtc,
    });

    expect(proof).toMatchObject({
      contentIntegrity: { status: "verified" },
      signature: { present: true, publicKeyId: record.signature.publicKeyId },
      outOfBandVerification: { status: "unverified", trustedPublicKeyId: null },
      ledgerInclusion: { status: "included", sequence: 1 },
      ledgerChain: { status: "verified" },
    });
  });

  it("reports valid, invalid, and key-mismatched out-of-band checks distinctly", async () => {
    const { receipt, pem, record } = await signedFixture();
    const trusted = await importVerifyingKey(pem.publicKeyPem);
    const valid = await buildReceiptProof(resolutionFor(receipt), ledgerFor(entryFor(record)), {
      checkedAtUtc,
      trustedPublicKeys: new Map([[pem.publicKeyId, trusted]]),
    });
    expect(valid.outOfBandVerification).toMatchObject({
      status: "valid",
      trustedPublicKeyId: pem.publicKeyId,
    });

    const first = record.signature.signature[0] === "A" ? "B" : "A";
    const invalidRecord: SignedReceipt = {
      ...record,
      signature: {
        ...record.signature,
        signature: `${first}${record.signature.signature.slice(1)}`,
      },
    };
    const invalid = await buildReceiptProof(
      resolutionFor(receipt),
      ledgerFor(entryFor(invalidRecord)),
      {
        checkedAtUtc,
        trustedPublicKeys: new Map([[pem.publicKeyId, trusted]]),
      },
    );
    expect(invalid.contentIntegrity.status).toBe("verified");
    expect(invalid.outOfBandVerification.status).toBe("invalid");

    const other = await generateSigningKeyPair();
    const mismatch = await buildReceiptProof(
      resolutionFor(receipt),
      ledgerFor(entryFor(record)),
      {
        checkedAtUtc,
        trustedPublicKeys: new Map([
          [record.signature.publicKeyId, await importVerifyingKey(other.publicKeyPem)],
        ]),
      },
    );
    expect(mismatch.outOfBandVerification).toMatchObject({
      status: "key-mismatch",
      trustedPublicKeyId: other.publicKeyId,
    });
  });

  it("reports receipt tampering independently from signature and ledger claims", async () => {
    const { receipt, pem, record } = await signedFixture();
    const tamperedRecord: SignedReceipt = {
      ...record,
      receipt: { ...record.receipt, appVersion: "tampered" },
    };
    const proof = await buildReceiptProof(
      resolutionFor(receipt),
      ledgerFor(entryFor(tamperedRecord), {
        ok: false,
        entries: 1,
        headChainSha256: chainSha256,
        breaks: [{ seq: 1, receiptId: receipt.receiptId, reason: "receipt content mismatch" }],
      }),
      {
        checkedAtUtc,
        trustedPublicKeys: new Map([
          [pem.publicKeyId, await importVerifyingKey(pem.publicKeyPem)],
        ]),
      },
    );

    expect(proof.contentIntegrity.status).toBe("mismatch");
    expect(proof.signature.present).toBe(true);
    expect(proof.outOfBandVerification.status).toBe("invalid");
    expect(proof.ledgerInclusion.status).toBe("included");
    expect(proof.ledgerChain.status).toBe("invalid");
  });

  it("separates a missing entry, an invalid chain, and an unavailable ledger", async () => {
    const { receipt, record } = await signedFixture();
    const resolution = resolutionFor(receipt);

    const missing = await buildReceiptProof(resolution, ledgerFor(null), { checkedAtUtc });
    expect(missing).toMatchObject({
      contentIntegrity: { status: "not-checked" },
      signature: { present: null },
      ledgerInclusion: { status: "not-included" },
      ledgerChain: { status: "verified", headChainSha256: null },
    });

    const invalidChain = await buildReceiptProof(
      resolution,
      ledgerFor(entryFor(record), {
        ok: false,
        entries: 1,
        headChainSha256: chainSha256,
        breaks: [{ seq: 1, receiptId: receipt.receiptId, reason: "broken link" }],
      }),
      { checkedAtUtc },
    );
    expect(invalidChain.ledgerInclusion.status).toBe("included");
    expect(invalidChain.ledgerChain.status).toBe("invalid");

    const unavailable: ReceiptProofLedger = {
      get: () => {
        throw new Error("database unavailable");
      },
      verifyChain: async () => {
        throw new Error("database unavailable");
      },
    };
    const unavailableProof = await buildReceiptProof(resolution, unavailable, {
      checkedAtUtc,
    });
    expect(unavailableProof).toMatchObject({
      contentIntegrity: { status: "not-checked" },
      signature: { present: null },
      ledgerInclusion: { status: "unavailable" },
      ledgerChain: { status: "unavailable" },
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["schema-invalid JSON", "{}"],
  ])(
    "reports stored record_json corruption as invalid rather than unavailable: %s",
    async (_caseName, corruptedRecordJson) => {
      const directory = mkdtempSync(path.join(tmpdir(), "changesafe-receipt-proof-"));
      const file = path.join(directory, "ledger.db");
      const { receipt, record } = await signedFixture();
      const ledger = Ledger.open(file);

      try {
        await ledger.append(record);
      } finally {
        ledger.close();
      }

      const raw = new DatabaseSync(file);
      try {
        raw.exec("DROP TRIGGER receipts_no_update");
        raw
          .prepare("UPDATE receipts SET record_json = ? WHERE receipt_id = ?")
          .run(corruptedRecordJson, receipt.receiptId);
      } finally {
        raw.close();
      }

      const corrupted = Ledger.open(file);
      try {
        const proof = await buildReceiptProof(resolutionFor(receipt), corrupted, {
          checkedAtUtc,
        });
        expect(proof).toMatchObject({
          contentIntegrity: { status: "not-checked" },
          signature: { present: null, publicKeyId: null },
          outOfBandVerification: { status: "not-checked" },
          ledgerInclusion: { status: "invalid" },
          ledgerChain: { status: "invalid" },
        });
      } finally {
        corrupted.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("reports an unsigned record as absent without inventing an OOB check", async () => {
    const receipt = await someReceipt();
    const proof = await buildReceiptProof(resolutionFor(receipt), ledgerFor(entryFor(receipt)), {
      checkedAtUtc,
    });

    expect(proof).toMatchObject({
      contentIntegrity: { status: "verified" },
      signature: { present: false, publicKeyId: null },
      outOfBandVerification: {
        status: "not-checked",
        trustedPublicKeyId: null,
        checkedAtUtc: null,
      },
    });
  });
});
