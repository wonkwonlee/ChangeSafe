import { z } from "zod";
import {
  IdSchema,
  JsonValueSchema,
  Sha256HexSchema,
  TimestampSchema,
} from "@changesafe/core";

import {
  REVIEW_CONTRACT_VERSION,
  ReviewSessionEnvelopeSchema,
} from "@/features/domains/review-contract";

/** Domains the authenticated self-hosted review service accepts today. */
export const DurableReviewDomainIdSchema = z.enum(["network", "terraform"]);

const DurableReviewSourceSchema = z.discriminatedUnion("domainId", [
  z.strictObject({
    domainId: z.literal("network"),
    sourceId: IdSchema,
    sourceKind: z.literal("network-incident-bundle"),
    origin: z.enum(["uploaded-offline-artifact", "read-only-collector"]),
    collectedAtUtc: TimestampSchema,
  }),
  z.strictObject({
    domainId: z.literal("terraform"),
    sourceId: IdSchema,
    sourceKind: z.literal("terraform-show-json"),
    origin: z.enum(["uploaded-offline-artifact", "read-only-collector"]),
    collectedAtUtc: TimestampSchema,
  }),
]);

const DurableReviewInputEnvelopeSchema = z.strictObject({
  inputId: IdSchema,
  inputSha256: Sha256HexSchema,
  /** Untrusted, schema-validated input; the domain validates its shape later. */
  content: JsonValueSchema,
});

/**
 * Intake is deliberately offline/read-only. It records what was submitted,
 * not a claim that a live system was queried or changed.
 */
export const DurableReviewIntakeSchema = z
  .strictObject({
    domainId: DurableReviewDomainIdSchema,
    source: DurableReviewSourceSchema,
    input: DurableReviewInputEnvelopeSchema,
  })
  .superRefine((intake, context) => {
    if (intake.domainId !== intake.source.domainId) {
      context.addIssue({
        code: "custom",
        path: ["source", "domainId"],
        message: "durable intake source domain must match the intake domain",
      });
    }
  });

const DurableReceiptBindingSchema = z.strictObject({
  receiptId: IdSchema,
  sourceId: IdSchema,
  inputId: IdSchema,
  inputSha256: Sha256HexSchema,
  proposalId: IdSchema,
  proposalSha256: Sha256HexSchema,
  policyVersion: z.string().min(1).max(32),
  receiptSha256: Sha256HexSchema,
});

/**
 * Immutable metadata for a review the self-hosted service has durably
 * recorded. It is a contract, not a persistence implementation or an API.
 */
export const DurableReviewRecordSchema = z
  .strictObject({
    recordVersion: z.literal("1"),
    reviewId: IdSchema,
    createdAtUtc: TimestampSchema,
    session: ReviewSessionEnvelopeSchema,
    intake: DurableReviewIntakeSchema,
    receipt: DurableReceiptBindingSchema,
    storage: z.strictObject({ kind: z.literal("append-only-ledger") }),
  })
  .superRefine((record, context) => {
    if (record.session.contractVersion !== REVIEW_CONTRACT_VERSION) {
      context.addIssue({
        code: "custom",
        path: ["session", "contractVersion"],
        message: "durable records require the current review contract version",
      });
    }
    if (record.session.runtimeMode !== "self-hosted") {
      context.addIssue({
        code: "custom",
        path: ["session", "runtimeMode"],
        message: "only authenticated self-hosted sessions may form durable records",
      });
    }
    if (!record.session.capabilities.durableDecision) {
      context.addIssue({
        code: "custom",
        path: ["session", "capabilities", "durableDecision"],
        message: "durable records require explicitly advertised durable decision support",
      });
    }
    if (record.session.domainId !== record.intake.domainId) {
      context.addIssue({
        code: "custom",
        path: ["intake", "domainId"],
        message: "record session and intake must name the same domain",
      });
    }
    if (record.receipt.sourceId !== record.intake.source.sourceId) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "sourceId"],
        message: "receipt source must bind to the immutable intake source",
      });
    }
    if (record.receipt.inputId !== record.intake.input.inputId) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "inputId"],
        message: "receipt input must bind to the immutable intake input",
      });
    }
    if (record.receipt.inputSha256 !== record.intake.input.inputSha256) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "inputSha256"],
        message: "receipt input hash must bind to the immutable intake input",
      });
    }
    if (record.receipt.policyVersion !== record.session.policyVersion) {
      context.addIssue({
        code: "custom",
        path: ["receipt", "policyVersion"],
        message: "receipt policy version must bind to the evaluating session",
      });
    }
  });

const ContentIntegrityClaimSchema = z.strictObject({
  status: z.enum(["verified", "mismatch", "not-checked"]),
  checkedAtUtc: TimestampSchema.nullable(),
}).superRefine((claim, context) => {
  if ((claim.status === "verified" || claim.status === "mismatch") && claim.checkedAtUtc === null) {
    context.addIssue({ code: "custom", path: ["checkedAtUtc"], message: "checked integrity claims require a check time" });
  }
  if (claim.status === "not-checked" && claim.checkedAtUtc !== null) {
    context.addIssue({ code: "custom", path: ["checkedAtUtc"], message: "unchecked integrity claims cannot imply a check time" });
  }
});

const ReceiptSignaturePresenceSchema = z.discriminatedUnion("present", [
  z.strictObject({ present: z.literal(true), publicKeyId: z.string().regex(/^[a-f0-9]{32}$/) }),
  z.strictObject({ present: z.literal(false), publicKeyId: z.null() }),
]);

const OutOfBandVerificationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-checked"), trustedPublicKeyId: z.null(), checkedAtUtc: z.null() }),
  z.strictObject({ status: z.literal("unverified"), trustedPublicKeyId: z.null(), checkedAtUtc: TimestampSchema }),
  z.strictObject({ status: z.enum(["valid", "invalid", "key-mismatch"]), trustedPublicKeyId: z.string().regex(/^[a-f0-9]{32}$/), checkedAtUtc: TimestampSchema }),
]);

const LedgerInclusionClaimSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("included"), sequence: z.number().int().positive(), chainSha256: Sha256HexSchema, checkedAtUtc: TimestampSchema }),
  z.strictObject({ status: z.enum(["not-included", "not-checked"]), sequence: z.null(), chainSha256: z.null(), checkedAtUtc: z.null() }),
]);

/**
 * Claims about a receipt are kept separate on purpose. A valid content hash
 * does not prove authorship, a signature without an out-of-band key is not
 * verified, and ledger inclusion does not make either claim true. This schema
 * does not calculate any proof; a verifier must populate it from real checks.
 */
export const ReceiptProofSchema = z
  .strictObject({
    reviewId: IdSchema,
    receiptId: IdSchema,
    receiptSha256: Sha256HexSchema,
    contentIntegrity: ContentIntegrityClaimSchema,
    signature: ReceiptSignaturePresenceSchema,
    outOfBandVerification: OutOfBandVerificationSchema,
    ledgerInclusion: LedgerInclusionClaimSchema,
  })
  .superRefine((proof, context) => {
    if (!proof.signature.present && proof.outOfBandVerification.status !== "not-checked") {
      context.addIssue({
        code: "custom",
        path: ["outOfBandVerification", "status"],
        message: "a receipt without a signature cannot claim out-of-band verification",
      });
    }
    if (proof.signature.present && proof.outOfBandVerification.status === "valid" && proof.outOfBandVerification.trustedPublicKeyId !== proof.signature.publicKeyId) {
      context.addIssue({
        code: "custom",
        path: ["outOfBandVerification", "trustedPublicKeyId"],
        message: "a valid out-of-band verification must name the signing key",
      });
    }
  });

export type DurableReviewIntake = z.infer<typeof DurableReviewIntakeSchema>;
export type DurableReviewRecord = z.infer<typeof DurableReviewRecordSchema>;
export type ReceiptProof = z.infer<typeof ReceiptProofSchema>;
