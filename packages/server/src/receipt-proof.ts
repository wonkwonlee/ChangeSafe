import {
  computePublicKeyId,
  verifyReceiptHash,
  verifyReceiptSignature,
  type ChangeReceipt,
  type SignedReceipt,
} from "@changesafe/core";
import {
  LedgerCorruptionError,
  type ChainVerdict,
  type LedgerEntry,
} from "@changesafe/ledger";

import {
  verifyReceiptProof,
  type DurableReviewResolution,
  type ReceiptProof,
} from "../../../features/reviews/durable-review-contract";

export interface ReceiptProofLedger {
  get(receiptId: string): LedgerEntry | null;
  verifyChain(): Promise<ChainVerdict>;
}

function receiptOf(record: ChangeReceipt | SignedReceipt): ChangeReceipt {
  return "receipt" in record ? record.receipt : record;
}

function unavailableRecordClaims() {
  return {
    contentIntegrity: { status: "not-checked" as const, checkedAtUtc: null },
    signature: { present: null, publicKeyId: null },
    outOfBandVerification: {
      status: "not-checked" as const,
      trustedPublicKeyId: null,
      checkedAtUtc: null,
    },
  };
}

async function recordClaims(
  resolution: DurableReviewResolution,
  entry: LedgerEntry,
  trustedPublicKeys: ReadonlyMap<string, CryptoKey> | undefined,
  checkedAtUtc: string,
) {
  const record = entry.record;
  const receipt = receiptOf(record);
  const integrityVerified =
    (await verifyReceiptHash(receipt)) &&
    receipt.receiptId === resolution.receipt.receiptId &&
    receipt.receiptSha256 === resolution.receipt.receiptSha256 &&
    entry.receiptId === resolution.receipt.receiptId &&
    entry.receiptSha256 === resolution.receipt.receiptSha256;

  if (!("receipt" in record)) {
    return {
      contentIntegrity: {
        status: integrityVerified ? "verified" as const : "mismatch" as const,
        checkedAtUtc,
      },
      signature: { present: false as const, publicKeyId: null },
      outOfBandVerification: {
        status: "not-checked" as const,
        trustedPublicKeyId: null,
        checkedAtUtc: null,
      },
    };
  }

  const trustedPublicKey = trustedPublicKeys?.get(record.signature.publicKeyId);
  if (!trustedPublicKey) {
    return {
      contentIntegrity: {
        status: integrityVerified ? "verified" as const : "mismatch" as const,
        checkedAtUtc,
      },
      signature: {
        present: true as const,
        publicKeyId: record.signature.publicKeyId,
      },
      outOfBandVerification: {
        status: "unverified" as const,
        trustedPublicKeyId: null,
        checkedAtUtc,
      },
    };
  }

  const trustedPublicKeyId = await computePublicKeyId(trustedPublicKey);
  const signatureVerdict = await verifyReceiptSignature(record, trustedPublicKey);
  if (signatureVerdict === "unverified") {
    throw new Error("signature verification returned an unchecked verdict despite a trusted key");
  }
  return {
    contentIntegrity: {
      status: integrityVerified ? "verified" as const : "mismatch" as const,
      checkedAtUtc,
    },
    signature: {
      present: true as const,
      publicKeyId: record.signature.publicKeyId,
    },
    outOfBandVerification: {
      status: signatureVerdict === "key_mismatch" ? "key-mismatch" as const : signatureVerdict,
      trustedPublicKeyId,
      checkedAtUtc,
    },
  };
}

/**
 * Recompute each receipt claim from its own evidence source. In particular,
 * content integrity never implies authorship, and an included row never
 * implies that the ledger chain or signature is valid.
 */
export async function buildReceiptProof(
  resolution: DurableReviewResolution,
  ledger: ReceiptProofLedger,
  options: {
    checkedAtUtc: string;
    trustedPublicKeys?: ReadonlyMap<string, CryptoKey>;
  },
): Promise<ReceiptProof> {
  let entry: LedgerEntry | null = null;
  let entryStatus: "available" | "invalid" | "unavailable" = "available";
  try {
    entry = ledger.get(resolution.receipt.receiptId);
  } catch (error) {
    entryStatus = error instanceof LedgerCorruptionError ? "invalid" : "unavailable";
  }

  const claims = entry
    ? await recordClaims(
        resolution,
        entry,
        options.trustedPublicKeys,
        options.checkedAtUtc,
      )
    : unavailableRecordClaims();

  const ledgerInclusion = entryStatus !== "available"
    ? {
        status: entryStatus,
        sequence: null,
        chainSha256: null,
        checkedAtUtc: options.checkedAtUtc,
      }
    : entry &&
        entry.receiptId === resolution.receipt.receiptId &&
        entry.receiptSha256 === resolution.receipt.receiptSha256
      ? {
          status: "included" as const,
          sequence: entry.seq,
          chainSha256: entry.chainSha256,
          checkedAtUtc: options.checkedAtUtc,
        }
      : {
          status: "not-included" as const,
          sequence: null,
          chainSha256: null,
          checkedAtUtc: options.checkedAtUtc,
        };

  let ledgerChain:
    | {
        status: "verified" | "invalid";
        headChainSha256: string | null;
        checkedAtUtc: string;
      }
    | {
        status: "unavailable";
        headChainSha256: null;
        checkedAtUtc: string;
      };
  try {
    const verdict = await ledger.verifyChain();
    ledgerChain = {
      status: verdict.ok ? "verified" : "invalid",
      headChainSha256: verdict.headChainSha256,
      checkedAtUtc: options.checkedAtUtc,
    };
  } catch (error) {
    ledgerChain = {
      status: error instanceof LedgerCorruptionError ? "invalid" : "unavailable",
      headChainSha256: null,
      checkedAtUtc: options.checkedAtUtc,
    };
  }

  return verifyReceiptProof(resolution, {
    reviewId: resolution.reviewId,
    receiptId: resolution.receipt.receiptId,
    receiptSha256: resolution.receipt.receiptSha256,
    ...claims,
    ledgerInclusion,
    ledgerChain,
  });
}
