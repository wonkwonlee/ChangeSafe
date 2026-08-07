import { z } from "zod";
import { AnalysisModeSchema, FixtureProvenanceSchema } from "./analysis";
import {
  PolicyFindingSchema,
  PolicyIdSchema,
  RiskLevelSchema,
  SKIPPABLE_UNIVERSAL_POLICY_IDS,
  UNIVERSAL_POLICY_IDS,
} from "./findings";
import { IdSchema, Sha256HexSchema, TimestampSchema } from "./primitives";
import { SimulationResultSchema } from "./simulation";

/**
 * What actually answered a skipped universal policy's question, mirroring
 * `SkipReplacement` in `domain.ts`. Only `"domain-policy"` exists: a
 * replacement that is not a policy would produce no finding, so the gate
 * would pass with a genuine gap rather than an honestly-labeled one. The
 * named id can never be a universal policy id, mirroring the same check
 * `evaluatePolicies` makes before this ever reaches a receipt.
 */
export const SkipReplacementSchema = z.strictObject({
  kind: z.literal("domain-policy"),
  policyId: PolicyIdSchema.refine(
    (id) => !(UNIVERSAL_POLICY_IDS as readonly string[]).includes(id),
    "a skip replacement cannot name a universal policy id",
  ),
});

export const SkippedUniversalPolicySchema = z.strictObject({
  policyId: z.enum(SKIPPABLE_UNIVERSAL_POLICY_IDS),
  because: z.string().min(1).max(1000),
  replacedBy: SkipReplacementSchema,
});

/**
 * The exact policy coverage a receipt's gate run produced, so a verifier
 * reads what was skipped and why from the signed payload itself rather than
 * having to fetch and trust the adapter's source to interpret an absent
 * policy id.
 */
export const PolicyCoverageSchema = z.strictObject({
  orderedPolicyIds: z.array(PolicyIdSchema).min(1).max(32),
  skippedPolicies: z
    .array(SkippedUniversalPolicySchema)
    .max(SKIPPABLE_UNIVERSAL_POLICY_IDS.length),
});

/**
 * `gate_only` records an automated evaluation with no human decision — what
 * the CLI produces in CI. It is never an approval: nothing may act on a
 * gate-only receipt as if a person had accepted the change.
 */
export const ReceiptDecisionSchema = z.enum([
  "approved",
  "rejected",
  "blocked",
  "gate_only",
]);

/**
 * Who made a decision, when an authenticated identity was established.
 *
 * Null means no authenticated approver was recorded — which is the honest
 * answer for a CLI gate run or the single-operator console, not a claim that
 * nobody decided. A receipt must never imply an accountable human where there
 * was only a process.
 */
export const ApproverSchema = z.strictObject({
  /** Stable subject claim from the identity provider. */
  subject: z.string().min(1).max(255),
  /** Issuer that vouched for the subject. */
  issuer: z.string().min(1).max(255),
  /** Convenience only; `subject` is the identifier that matters. */
  email: z.string().max(255).nullable(),
});

/**
 * The durable record of one airlock decision.
 *
 * `inputId` / `inputSha256` describe whatever was analyzed — an incident
 * bundle, a plan, a snapshot — so the receipt shape is the same across
 * domains. `sourceId` names where that input came from (a bundled scenario
 * id, a file, a pipeline run).
 */
export const ChangeReceiptSchema = z
  .strictObject({
    receiptId: IdSchema,
    inputId: IdSchema,
    proposalId: IdSchema,
    sourceId: IdSchema,
    appVersion: z.string().min(1).max(32),
    policyVersion: z.string().min(1).max(32),
    createdAtUtc: TimestampSchema,
    mode: AnalysisModeSchema,
    /** Runtime model for live analyses; null when replaying an authored fixture. */
    model: z.string().max(64).nullable(),
    fixtureProvenance: FixtureProvenanceSchema.nullable(),
    inputSha256: Sha256HexSchema,
    proposalSha256: Sha256HexSchema,
    findings: z.array(PolicyFindingSchema).min(1).max(32),
    /**
     * What ran and what was skipped, so absence never reads as approval.
     * Optional only so a receipt issued before this field existed (v0.4.1
     * and earlier — see `verification/v0.1.0/receipt.signed.json`) still
     * parses for hash/signature verification; `createReceipt` always sets
     * it for anything issued going forward, and `canonicalize` drops an
     * `undefined` property, so a legacy receipt's hash is unaffected by its
     * absence here.
     */
    policyCoverage: PolicyCoverageSchema.optional(),
    riskLevel: RiskLevelSchema,
    decision: ReceiptDecisionSchema,
    /** The authenticated human who decided, when there was one. */
    approver: ApproverSchema.nullable(),
    simulation: SimulationResultSchema.nullable(),
    /** SHA-256 of the canonical receipt content excluding this field. */
    receiptSha256: Sha256HexSchema,
  })
  .superRefine((receipt, ctx) => {
    if (receipt.mode === "live" && receipt.fixtureProvenance !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["fixtureProvenance"],
        message: "live receipts must not carry fixture provenance",
      });
    }
    // Offline runs may carry provenance if the supplied file declared it,
    // and may equally carry none — the gate attests only what it was given.
    if (receipt.mode === "replay" && receipt.fixtureProvenance === null) {
      ctx.addIssue({
        code: "custom",
        path: ["fixtureProvenance"],
        message: "replay receipts must declare fixture provenance",
      });
    }
    if (receipt.decision !== "approved" && receipt.simulation !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "only approved changes may carry a simulation result",
      });
    }
    // An automated gate run has no human behind it, and must not appear to.
    if (receipt.decision === "gate_only" && receipt.approver !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["approver"],
        message: "a gate-only receipt records no human decision and must not name an approver",
      });
    }
    if (receipt.decision === "approved" && receipt.simulation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "approved receipts are issued only after simulation completes",
      });
    }
  });

export type Approver = z.infer<typeof ApproverSchema>;
export type ReceiptDecision = z.infer<typeof ReceiptDecisionSchema>;
export type ChangeReceipt = z.infer<typeof ChangeReceiptSchema>;
