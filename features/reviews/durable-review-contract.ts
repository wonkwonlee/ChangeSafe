import { z } from "zod";
import {
  IdSchema,
  JsonValueSchema,
  Sha256HexSchema,
  TimestampSchema,
  hashCanonical,
} from "@changesafe/core";
import { IncidentBundleSchema } from "@changesafe/domain-network";
import { TerraformInputSchema } from "@changesafe/domain-terraform";

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
    // This is a *structural* intake schema.  The async verification helper
    // below also recomputes the canonical content hash before an intake can
    // be accepted by a self-hosted service.
    const domainSchema =
      intake.domainId === "network" ? IncidentBundleSchema : TerraformInputSchema;
    const content = domainSchema.safeParse(intake.input.content);
    if (!content.success) {
      context.addIssue({
        code: "custom",
        path: ["input", "content"],
        message: `durable ${intake.domainId} intake content must satisfy its domain schema`,
      });
    }
  });

/**
 * Validated, hash-bound intake.  Do not treat `DurableReviewIntakeSchema.parse`
 * as acceptance: Zod can validate structure but cannot prove a caller-supplied
 * content hash.  This function is the only acceptance boundary for intake.
 */
export async function verifyDurableReviewIntake(
  raw: unknown,
): Promise<DurableReviewIntake> {
  const intake = DurableReviewIntakeSchema.parse(raw);
  const inputSha256 = await hashCanonical(intake.input.content);
  if (inputSha256 !== intake.input.inputSha256) {
    throw new Error("durable intake inputSha256 does not match canonical input content");
  }
  return intake;
}

/** Construct an intake with its canonical content hash, never trusting a caller hash. */
export async function createDurableReviewIntake(
  raw: Omit<DurableReviewIntake, "input"> & {
    input: Omit<DurableReviewIntake["input"], "inputSha256">;
  },
): Promise<DurableReviewIntake> {
  const content = raw.input.content;
  return verifyDurableReviewIntake({
    ...raw,
    input: { ...raw.input, inputSha256: await hashCanonical(content) },
  });
}

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

const DurableReviewSessionBindingSchema = ReviewSessionEnvelopeSchema.superRefine(
  (session, context) => {
    if (session.contractVersion !== REVIEW_CONTRACT_VERSION) {
      context.addIssue({
        code: "custom",
        path: ["contractVersion"],
        message: "durable records require the current review contract version",
      });
    }
    if (session.runtimeMode !== "self-hosted") {
      context.addIssue({
        code: "custom",
        path: ["runtimeMode"],
        message: "only authenticated self-hosted sessions may form durable records",
      });
    }
    if (!session.capabilities.durableDecision) {
      context.addIssue({
        code: "custom",
        path: ["capabilities", "durableDecision"],
        message: "durable records require explicitly advertised durable decision support",
      });
    }
    if (session.analysisMode !== "offline") {
      context.addIssue({
        code: "custom",
        path: ["analysisMode"],
        message: "durable offline intake records must use offline analysis mode",
      });
    }
  },
);

function bindPendingRecord(
  record: {
    session: z.infer<typeof DurableReviewSessionBindingSchema>;
    intake: DurableReviewIntake;
  },
  context: z.RefinementCtx,
): void {
  if (record.session.domainId !== record.intake.domainId) {
    context.addIssue({
      code: "custom",
      path: ["intake", "domainId"],
      message: "record session and intake must name the same domain",
    });
  }
  if (record.session.source !== record.intake.source.origin) {
    context.addIssue({
      code: "custom",
      path: ["session", "source"],
      message: "durable session source must bind exactly to the intake origin",
    });
  }
  if (record.session.provenance !== record.intake.source.origin) {
    context.addIssue({
      code: "custom",
      path: ["session", "provenance"],
      message: "durable session provenance must bind exactly to the intake origin",
    });
  }
}

/**
 * Immutable queue item written at authenticated self-hosted intake time.
 *
 * A pending record intentionally contains no receipt, proposal, decision, or
 * proof claim.  The caller can only submit read-only input; the later server
 * decision path must append a separately-bound resolution after it has
 * recomputed the verdict and issued its receipt.
 */
export const PendingDurableReviewRecordSchema = z
  .strictObject({
    recordVersion: z.literal("2"),
    reviewId: IdSchema,
    createdAtUtc: TimestampSchema,
    session: DurableReviewSessionBindingSchema,
    intake: DurableReviewIntakeSchema,
    storage: z.strictObject({ kind: z.literal("append-only-review-store") }),
  })
  .superRefine(bindPendingRecord);

/**
 * Immutable server-side resolution for a previously stored pending review.
 * This is intentionally an append-only companion record, never a mutable
 * receipt field on the intake record.
 */
export const DurableReviewResolutionSchema = z
  .strictObject({
    resolutionVersion: z.literal("1"),
    reviewId: IdSchema,
    resolvedAtUtc: TimestampSchema,
    receipt: DurableReceiptBindingSchema,
  });

/**
 * Legacy resolved record shape retained only while the current store is
 * migrated. New intake endpoints must create PendingDurableReviewRecordSchema
 * records and later append DurableReviewResolutionSchema separately.
 */
export const DurableReviewRecordSchema = z
  .strictObject({
    recordVersion: z.literal("1"),
    reviewId: IdSchema,
    createdAtUtc: TimestampSchema,
    session: DurableReviewSessionBindingSchema,
    intake: DurableReviewIntakeSchema,
    receipt: DurableReceiptBindingSchema,
    storage: z.strictObject({ kind: z.literal("append-only-ledger") }),
  })
  .superRefine((record, context) => {
    bindPendingRecord(record, context);
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

/**
 * The only durable-record acceptance boundary.  A persistence adapter must
 * call this before appending a review record: structural parsing alone cannot
 * establish that a caller's intake hash represents the submitted content.
 *
 * This function intentionally does not persist anything.  The server owns
 * the subsequent atomic append to its review store and append-only ledger.
 */
export async function acceptDurableReviewRecordForPersistence(
  raw: unknown,
): Promise<DurableReviewRecord> {
  // Extract the untrusted intake without accepting the rest of the record so
  // hash/domain verification is necessarily completed before receipt binding.
  const candidate = z.object({ intake: z.unknown() }).passthrough().parse(raw);
  const intake = await verifyDurableReviewIntake(candidate.intake);

  // The record schema then binds the verified intake to the authenticated
  // session and every immutable receipt identity/hash field.
  return DurableReviewRecordSchema.parse({ ...candidate, intake });
}

/**
 * The POST-intake acceptance boundary. This recomputes the untrusted input
 * hash before allowing a receipt-free pending record into the review queue.
 */
export async function acceptPendingDurableReviewRecordForPersistence(
  raw: unknown,
): Promise<PendingDurableReviewRecord> {
  const candidate = z.object({ intake: z.unknown() }).passthrough().parse(raw);
  const intake = await verifyDurableReviewIntake(candidate.intake);
  return PendingDurableReviewRecordSchema.parse({ ...candidate, intake });
}

/**
 * Bind a server-issued receipt to an immutable pending record. This helper is
 * deliberately not an intake parser: its `receipt` argument must come from
 * the server's recomputed decision/receipt path, never from the POST body.
 */
export function bindServerResolutionToPendingReview(
  pending: PendingDurableReviewRecord,
  raw: unknown,
): DurableReviewResolution {
  const resolution = DurableReviewResolutionSchema.parse(raw);
  if (resolution.reviewId !== pending.reviewId) {
    throw new Error("durable resolution does not match the immutable pending review");
  }
  if (resolution.receipt.sourceId !== pending.intake.source.sourceId) {
    throw new Error("durable resolution receipt source does not match the immutable intake");
  }
  if (resolution.receipt.inputId !== pending.intake.input.inputId) {
    throw new Error("durable resolution receipt input does not match the immutable intake");
  }
  if (resolution.receipt.inputSha256 !== pending.intake.input.inputSha256) {
    throw new Error("durable resolution receipt input hash does not match the immutable intake");
  }
  if (resolution.receipt.policyVersion !== pending.session.policyVersion) {
    throw new Error("durable resolution receipt policy version does not match the evaluating session");
  }
  return resolution;
}

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
    if (
      proof.signature.present &&
      (proof.outOfBandVerification.status === "valid" ||
        proof.outOfBandVerification.status === "invalid") &&
      proof.outOfBandVerification.trustedPublicKeyId !== proof.signature.publicKeyId
    ) {
      context.addIssue({
        code: "custom",
        path: ["outOfBandVerification", "trustedPublicKeyId"],
        message: "a valid or invalid out-of-band verification must name the signing key",
      });
    }
    if (
      proof.signature.present &&
      proof.outOfBandVerification.status === "key-mismatch" &&
      proof.outOfBandVerification.trustedPublicKeyId === proof.signature.publicKeyId
    ) {
      context.addIssue({
        code: "custom",
        path: ["outOfBandVerification", "trustedPublicKeyId"],
        message: "a key mismatch must name a trusted key different from the signing key",
      });
    }
  });

/**
 * Validate a proof against the immutable receipt binding in its review record.
 * Parsing a proof alone validates its claim shape, not which durable review it
 * belongs to.
 */
export function verifyReceiptProof(
  binding: DurableReviewRecord | DurableReviewResolution,
  raw: unknown,
): ReceiptProof {
  const proof = ReceiptProofSchema.parse(raw);
  if (
    proof.reviewId !== binding.reviewId ||
    proof.receiptId !== binding.receipt.receiptId ||
    proof.receiptSha256 !== binding.receipt.receiptSha256
  ) {
    throw new Error("receipt proof does not match the immutable durable review receipt binding");
  }
  return proof;
}

export type DurableReviewIntake = z.infer<typeof DurableReviewIntakeSchema>;
export type PendingDurableReviewRecord = z.infer<typeof PendingDurableReviewRecordSchema>;
export type DurableReviewResolution = z.infer<typeof DurableReviewResolutionSchema>;
export type DurableReviewRecord = z.infer<typeof DurableReviewRecordSchema>;
export type ReceiptProof = z.infer<typeof ReceiptProofSchema>;
