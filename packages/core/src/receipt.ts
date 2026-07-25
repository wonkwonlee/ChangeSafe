import { z } from "zod";
import { AnalysisModeSchema, FixtureProvenanceSchema } from "./analysis";
import { PolicyFindingSchema, RiskLevelSchema } from "./findings";
import { IdSchema, Sha256HexSchema, TimestampSchema } from "./primitives";
import { SimulationResultSchema } from "./simulation";

export const ReceiptDecisionSchema = z.enum(["approved", "rejected", "blocked"]);

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
    riskLevel: RiskLevelSchema,
    decision: ReceiptDecisionSchema,
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
    if (receipt.decision === "approved" && receipt.simulation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "approved receipts are issued only after simulation completes",
      });
    }
  });

export type ReceiptDecision = z.infer<typeof ReceiptDecisionSchema>;
export type ChangeReceipt = z.infer<typeof ChangeReceiptSchema>;
