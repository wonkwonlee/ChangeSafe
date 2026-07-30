import { describe, expect, it } from "vitest";

import {
  acceptDurableReviewRecordForPersistence,
  acceptPendingDurableReviewRecordForPersistence,
  bindServerResolutionToPendingReview,
  createDurableReviewIntake,
  DurableReviewResolutionSchema,
  DurableReviewIntakeSchema,
  DurableReviewRecordSchema,
  PendingDurableReviewRecordSchema,
  ReceiptProofSchema,
  type DurableReviewIntake,
  verifyDurableReviewIntake,
  verifyReceiptProof,
} from "@/features/reviews/durable-review-contract";
import { SCENARIOS } from "@/scenarios";
import { normalizePlan } from "@changesafe/domain-terraform";
import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "@/features/domains/terraform/fixtures";
import { hashCanonical } from "@changesafe/core";

const sha = (character: string) => character.repeat(64);

function content(domainId: "network" | "terraform") {
  if (domainId === "network") return SCENARIOS[0]!.bundle;
  const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES[0]!;
  return normalizePlan(fixture.plan, { planId: fixture.inputId, context: [...fixture.context] });
}

async function intake(domainId: "network" | "terraform") {
  const input = content(domainId);
  const proposal = domainId === "network" ? SCENARIOS[0]!.fixture.proposal : null;
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
      untrustedArtifactObservedAtUtc: "2026-07-30T00:00:00.000Z",
    },
    input: {
      inputId: `${domainId}-input`,
      inputSha256: await hashCanonical(input),
      content: input,
    },
    ...(proposal
      ? {
          proposal: {
            proposalId: proposal.proposalId,
            proposalSha256: await hashCanonical(proposal),
            content: proposal,
          },
        }
      : {}),
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

async function record(domainId: "network" | "terraform") {
  const acceptedIntake = await intake(domainId);
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
      proposalId: acceptedIntake.proposal?.proposalId ?? `${domainId}-proposal`,
      proposalSha256: acceptedIntake.proposal?.proposalSha256 ?? sha("b"),
      policyVersion: `${domainId}-policy-v1`,
      receiptSha256: sha("c"),
    },
    storage: { kind: "append-only-ledger" },
  } as const;
}

async function pendingRecord(domainId: "network" | "terraform") {
  return {
    recordVersion: "2",
    reviewId: `${domainId}-review`,
    createdAtUtc: "2026-07-30T00:01:00.000Z",
    owner: { tenantId: "https://idp.test", issuer: "https://idp.test", subject: "user-alice", scope: "self-hosted-review" },
    session: session(domainId),
    intake: await intake(domainId),
    storage: { kind: "append-only-review-store" },
  } as const;
}

function resolution(domainId: "network" | "terraform", acceptedIntake: DurableReviewIntake) {
  return {
    resolutionVersion: "1",
    reviewId: `${domainId}-review`,
    resolvedAtUtc: "2026-07-30T00:02:00.000Z",
    receipt: {
      receiptId: `${domainId}-receipt`,
      sourceId: acceptedIntake.source.sourceId,
      inputId: acceptedIntake.input.inputId,
      inputSha256: acceptedIntake.input.inputSha256,
      proposalId: acceptedIntake.proposal?.proposalId ?? `${domainId}-proposal`,
      proposalSha256: acceptedIntake.proposal?.proposalSha256 ?? sha("b"),
      policyVersion: `${domainId}-policy-v1`,
      receiptSha256: sha("c"),
    },
  } as const;
}

describe("durable self-hosted review contracts", () => {
  it.each(["network", "terraform"] as const)(
    "accepts a self-hosted %s offline intake and durable record",
    async (domainId) => {
      const acceptedIntake = await intake(domainId);
      expect(await verifyDurableReviewIntake(acceptedIntake)).toMatchObject({ domainId });
      expect(DurableReviewRecordSchema.parse(await record(domainId))).toMatchObject({
        reviewId: `${domainId}-review`,
        storage: { kind: "append-only-ledger" },
      });
      await expect(acceptDurableReviewRecordForPersistence(await record(domainId))).resolves.toMatchObject({
        reviewId: `${domainId}-review`,
        intake: { input: { inputSha256: acceptedIntake.input.inputSha256 } },
      });
    },
  );

  it("rejects a valid-shaped forged Network proposal hash on the v1 persistence path", async () => {
    const candidate = await record("network");
    const forgedHash = sha("f");
    expect(DurableReviewRecordSchema.safeParse({
      ...candidate,
      intake: {
        ...candidate.intake,
        proposal: {
          ...candidate.intake.proposal!,
          proposalSha256: forgedHash,
        },
      },
      receipt: {
        ...candidate.receipt,
        proposalSha256: forgedHash,
      },
    }).success).toBe(true);
    await expect(acceptDurableReviewRecordForPersistence({
      ...candidate,
      intake: {
        ...candidate.intake,
        proposal: {
          ...candidate.intake.proposal!,
          proposalSha256: forgedHash,
        },
      },
      receipt: {
        ...candidate.receipt,
        proposalSha256: forgedHash,
      },
    })).rejects.toThrow(/proposalSha256/);
  });

  it.each(["network", "terraform"] as const)(
    "creates a receipt-free pending %s review and binds a later server resolution",
    async (domainId) => {
      const pending = await pendingRecord(domainId);
      expect("receipt" in pending).toBe(false);
      expect(PendingDurableReviewRecordSchema.parse(pending)).toMatchObject({
        reviewId: `${domainId}-review`,
        storage: { kind: "append-only-review-store" },
      });
      const accepted = await acceptPendingDurableReviewRecordForPersistence(pending);
      const bound = bindServerResolutionToPendingReview(
        accepted,
        resolution(domainId, accepted.intake),
      );
      expect(DurableReviewResolutionSchema.parse(bound)).toMatchObject({
        reviewId: accepted.reviewId,
        receipt: { inputSha256: accepted.intake.input.inputSha256 },
      });
    },
  );

  it("rejects caller receipt injection into a pending intake and a forged later resolution", async () => {
    const pending = await pendingRecord("network");
    expect(
      PendingDurableReviewRecordSchema.safeParse({
        ...pending,
        receipt: (await record("network")).receipt,
      }).success,
    ).toBe(false);

    const accepted = await acceptPendingDurableReviewRecordForPersistence(pending);
    expect(() => bindServerResolutionToPendingReview(accepted, {
      ...resolution("network", accepted.intake),
      receipt: {
        ...resolution("network", accepted.intake).receipt,
        inputSha256: sha("f"),
      },
    })).toThrow(/input hash/);
  });

  it.each(["network", "terraform"] as const)(
    "rejects a forged %s record input and receipt hash before persistence",
    async (domainId) => {
      const candidate = await record(domainId);
      const forgedHash = sha("f");

      await expect(
        acceptDurableReviewRecordForPersistence({
          ...candidate,
          intake: {
            ...candidate.intake,
            input: { ...candidate.intake.input, inputSha256: forgedHash },
          },
          receipt: { ...candidate.receipt, inputSha256: forgedHash },
        }),
      ).rejects.toThrow(/inputSha256/);
    },
  );

  it("rejects Kubernetes, public replay, and legacy-local durable record claims", async () => {
    const networkIntake = await intake("network");
    expect(
      DurableReviewIntakeSchema.safeParse({
        ...networkIntake,
        domainId: "kubernetes",
        source: { ...networkIntake.source, domainId: "kubernetes" },
      }).success,
    ).toBe(false);

    for (const runtimeMode of ["public-replay", "legacy-local"] as const) {
      expect(
        DurableReviewRecordSchema.safeParse({
          ...(await record("network")),
          session: {
            ...session("network"),
            runtimeMode,
            capabilities: { ...session("network").capabilities, durableDecision: false },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects receipt bindings that contradict the immutable intake or session", async () => {
    const terraformRecord = await record("terraform");
    expect(
      DurableReviewRecordSchema.safeParse({
        ...terraformRecord,
        receipt: { ...terraformRecord.receipt, inputSha256: sha("d") },
      }).success,
    ).toBe(false);
    expect(
      DurableReviewRecordSchema.safeParse({
        ...terraformRecord,
        receipt: { ...terraformRecord.receipt, policyVersion: "other-policy" },
      }).success,
    ).toBe(false);
  });

  it("keeps integrity, signature, OOB verification, and ledger inclusion distinct", async () => {
    const acceptedRecord = DurableReviewRecordSchema.parse(await record("network"));
    const proof = ReceiptProofSchema.parse({
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
      });
    expect(verifyReceiptProof(acceptedRecord, proof)).toMatchObject({ outOfBandVerification: { status: "valid" } });

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

  it("requires a domain-valid canonical input and binds source provenance exactly", async () => {
    const accepted = await intake("network");
    await expect(verifyDurableReviewIntake({
      ...accepted,
      input: { ...accepted.input, inputSha256: sha("f") },
    })).rejects.toThrow(/inputSha256/);
    await expect(verifyDurableReviewIntake({
      ...accepted,
      proposal: { ...accepted.proposal!, proposalSha256: sha("f") },
    })).rejects.toThrow(/proposalSha256/);
    await expect(createDurableReviewIntake({
      domainId: "network",
      source: {
        domainId: "network",
        sourceId: accepted.source.sourceId,
        sourceKind: "network-incident-bundle",
        origin: accepted.source.origin,
        untrustedArtifactObservedAtUtc:
          accepted.source.untrustedArtifactObservedAtUtc,
      },
      input: { inputId: accepted.input.inputId, content: accepted.input.content },
    })).rejects.toThrow(/requires an immutable proposal/);
    expect(DurableReviewIntakeSchema.safeParse({
      ...(await intake("terraform")),
      proposal: accepted.proposal,
    }).success).toBe(false);
    expect(DurableReviewIntakeSchema.safeParse({
      ...accepted,
      input: { ...accepted.input, content: content("terraform") },
    }).success).toBe(false);
    const durableRecord = await record("network");
    expect(DurableReviewRecordSchema.safeParse({
      ...durableRecord,
      session: { ...durableRecord.session, source: "read-only-collector", provenance: "read-only-collector" },
    }).success).toBe(false);
    const built = await createDurableReviewIntake({
      domainId: "network",
      source: {
        domainId: "network",
        sourceId: "network-source",
        sourceKind: "network-incident-bundle",
        origin: "uploaded-offline-artifact",
        untrustedArtifactObservedAtUtc: "2026-07-30T00:00:00.000Z",
      },
      input: { inputId: "network-input", content: content("network") },
      proposal: {
        proposalId: SCENARIOS[0]!.fixture.proposal.proposalId,
        content: SCENARIOS[0]!.fixture.proposal,
      },
    });
    expect(built.input.inputSha256).toBe(accepted.input.inputSha256);
    expect(built.proposal?.proposalSha256).toBe(accepted.proposal?.proposalSha256);
  });

  it("binds receipt proofs to their immutable record and distinguishes OOB key states", async () => {
    const acceptedRecord = DurableReviewRecordSchema.parse(await record("network"));
    const base = {
      reviewId: acceptedRecord.reviewId,
      receiptId: acceptedRecord.receipt.receiptId,
      receiptSha256: acceptedRecord.receipt.receiptSha256,
      contentIntegrity: { status: "not-checked" as const, checkedAtUtc: null },
      signature: { present: true as const, publicKeyId: "d".repeat(32) },
      ledgerInclusion: { status: "not-checked" as const, sequence: null, chainSha256: null, checkedAtUtc: null },
    };
    expect(ReceiptProofSchema.safeParse({ ...base, outOfBandVerification: { status: "invalid", trustedPublicKeyId: "d".repeat(32), checkedAtUtc: "2026-07-30T00:02:00.000Z" } }).success).toBe(true);
    expect(ReceiptProofSchema.safeParse({ ...base, outOfBandVerification: { status: "invalid", trustedPublicKeyId: "e".repeat(32), checkedAtUtc: "2026-07-30T00:02:00.000Z" } }).success).toBe(false);
    expect(ReceiptProofSchema.safeParse({ ...base, outOfBandVerification: { status: "key-mismatch", trustedPublicKeyId: "e".repeat(32), checkedAtUtc: "2026-07-30T00:02:00.000Z" } }).success).toBe(true);
    expect(ReceiptProofSchema.safeParse({ ...base, outOfBandVerification: { status: "key-mismatch", trustedPublicKeyId: "d".repeat(32), checkedAtUtc: "2026-07-30T00:02:00.000Z" } }).success).toBe(false);
    expect(() => verifyReceiptProof(acceptedRecord, { ...base, reviewId: "other-review", outOfBandVerification: { status: "not-checked", trustedPublicKeyId: null, checkedAtUtc: null } })).toThrow(/immutable durable review/);
  });
});
