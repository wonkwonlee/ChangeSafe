import { describe, expect, it } from "vitest";

import {
  DurableReviewIntakeSchema,
  DurableReviewRecordSchema,
  ReceiptProofSchema,
} from "@/features/reviews/durable-review-contract";

const sha = (character: string) => character.repeat(64);

function intake(domainId: "network" | "terraform") {
  return {
    domainId,
    source: {
      domainId,
      sourceId: `${domainId}-source`,
      sourceKind:
        domainId === "network"
          ? "network-incident-bundle"
          : "terraform-show-json",
      origin: "uploaded-offline-artifact",
      collectedAtUtc: "2026-07-30T00:00:00.000Z",
    },
    input: {
      inputId: `${domainId}-input`,
      inputSha256: sha("a"),
      content: { domainId, revision: 1 },
    },
  } as const;
}

function session(domainId: "network" | "terraform") {
  return {
    domainId,
    contractVersion: "2.0.0",
    policyVersion: `${domainId}-policy-v1`,
    domainShape: domainId === "network" ? "simulated-state" : "external-diff",
    capabilities: {
      sandboxSimulation: domainId === "network",
      resourceGraph: true,
      structuredDiff: true,
      untrustedContext: true,
      durableDecision: true,
    },
    runtimeMode: "self-hosted",
    source: "uploaded-offline-artifact",
    analysisMode: "offline",
    provenance: "uploaded-offline-artifact",
  } as const;
}

function record(domainId: "network" | "terraform") {
  const acceptedIntake = intake(domainId);
  return {
    recordVersion: "1",
    reviewId: `${domainId}-review`,
    createdAtUtc: "2026-07-30T00:01:00.000Z",
    session: session(domainId),
    intake: acceptedIntake,
    receipt: {
      receiptId: `${domainId}-receipt`,
      sourceId: acceptedIntake.source.sourceId,
      inputId: acceptedIntake.input.inputId,
      inputSha256: acceptedIntake.input.inputSha256,
      proposalId: `${domainId}-proposal`,
      proposalSha256: sha("b"),
      policyVersion: `${domainId}-policy-v1`,
      receiptSha256: sha("c"),
    },
    storage: { kind: "append-only-ledger" },
  } as const;
}

describe("durable self-hosted review contracts", () => {
  it.each(["network", "terraform"] as const)(
    "accepts a self-hosted %s offline intake and durable record",
    (domainId) => {
      expect(DurableReviewIntakeSchema.parse(intake(domainId))).toMatchObject({ domainId });
      expect(DurableReviewRecordSchema.parse(record(domainId))).toMatchObject({
        reviewId: `${domainId}-review`,
        storage: { kind: "append-only-ledger" },
      });
    },
  );

  it("rejects Kubernetes, public replay, and legacy-local durable record claims", () => {
    expect(
      DurableReviewIntakeSchema.safeParse({
        ...intake("network"),
        domainId: "kubernetes",
        source: { ...intake("network").source, domainId: "kubernetes" },
      }).success,
    ).toBe(false);

    for (const runtimeMode of ["public-replay", "legacy-local"] as const) {
      expect(
        DurableReviewRecordSchema.safeParse({
          ...record("network"),
          session: {
            ...session("network"),
            runtimeMode,
            capabilities: { ...session("network").capabilities, durableDecision: false },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects receipt bindings that contradict the immutable intake or session", () => {
    expect(
      DurableReviewRecordSchema.safeParse({
        ...record("terraform"),
        receipt: { ...record("terraform").receipt, inputSha256: sha("d") },
      }).success,
    ).toBe(false);
    expect(
      DurableReviewRecordSchema.safeParse({
        ...record("terraform"),
        receipt: { ...record("terraform").receipt, policyVersion: "other-policy" },
      }).success,
    ).toBe(false);
  });

  it("keeps integrity, signature, OOB verification, and ledger inclusion distinct", () => {
    const acceptedRecord = record("network");
    expect(
      ReceiptProofSchema.parse({
        reviewId: acceptedRecord.reviewId,
        receiptId: acceptedRecord.receipt.receiptId,
        receiptSha256: acceptedRecord.receipt.receiptSha256,
        contentIntegrity: { status: "verified", checkedAtUtc: "2026-07-30T00:02:00.000Z" },
        signature: { present: true, publicKeyId: "d".repeat(32) },
        outOfBandVerification: {
          status: "valid",
          trustedPublicKeyId: "d".repeat(32),
          checkedAtUtc: "2026-07-30T00:02:00.000Z",
        },
        ledgerInclusion: {
          status: "included",
          sequence: 7,
          chainSha256: sha("e"),
          checkedAtUtc: "2026-07-30T00:02:00.000Z",
        },
      }),
    ).toMatchObject({ outOfBandVerification: { status: "valid" } });

    expect(
      ReceiptProofSchema.safeParse({
        reviewId: acceptedRecord.reviewId,
        receiptId: acceptedRecord.receipt.receiptId,
        receiptSha256: acceptedRecord.receipt.receiptSha256,
        contentIntegrity: { status: "verified", checkedAtUtc: "2026-07-30T00:02:00.000Z" },
        signature: { present: false, publicKeyId: null },
        outOfBandVerification: {
          status: "valid",
          trustedPublicKeyId: "d".repeat(32),
          checkedAtUtc: "2026-07-30T00:02:00.000Z",
        },
        ledgerInclusion: { status: "not-checked", sequence: null, chainSha256: null, checkedAtUtc: null },
      }).success,
    ).toBe(false);
  });
});
