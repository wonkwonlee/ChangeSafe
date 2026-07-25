import { z } from "zod";
import {
  EvidenceIdSchema,
  IdSchema,
  JsonValueSchema,
  StatePathSchema,
  TimestampSchema,
} from "./primitives";
import { FixtureProvenanceSchema } from "./analysis";

/**
 * The proposal contract: what an AI (or any other producer) may hand to the
 * gate. Operations are declarative state mutations — never commands.
 *
 * Domains narrow the operation `value` to their own shapes via
 * `makeProposalSchemas`, which keeps model-facing Structured Outputs schemas
 * strict while core stays domain-agnostic.
 */

export const ChangeOpKindSchema = z.enum(["add", "replace", "remove"]);

export const VerificationStepSchema = z.strictObject({
  kind: z.enum(["precondition", "postcheck"]),
  description: z.string().min(1).max(500),
  evidenceIds: z.array(EvidenceIdSchema).max(10),
});

export const DiagnosisSchema = z.strictObject({
  likelyCause: z.string().min(1).max(2000),
  /** Advisory only. Nothing in the gate may read this. */
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1).max(20),
  assumptions: z.array(z.string().min(1).max(400)).max(10),
});

/**
 * Build the operation, proposal, and replay-fixture schemas for a given
 * operation-value schema. Core exports permissive defaults; a domain passes
 * its own union to get strict, model-bindable schemas.
 */
export function makeProposalSchemas<TValue extends z.ZodTypeAny>(valueSchema: TValue) {
  const operation = z.strictObject({
    op: ChangeOpKindSchema,
    path: StatePathSchema,
    /** Required for add/replace; null for remove (enforced by the domain engine). */
    value: valueSchema,
    reason: z.string().min(1).max(500),
    evidenceIds: z.array(EvidenceIdSchema).min(1).max(10),
  });

  const proposal = z.strictObject({
    proposalId: IdSchema,
    summary: z.string().min(1).max(1000),
    diagnosis: DiagnosisSchema,
    operations: z.array(operation).min(1).max(10),
    /** Empty rollback is schema-valid so a policy can block it deterministically. */
    rollbackOperations: z.array(operation).max(10),
    /** Empty steps are schema-valid so a policy can warn deterministically. */
    verificationSteps: z.array(VerificationStepSchema).max(10),
  });

  const replayFixture = z
    .strictObject({
      fixtureId: IdSchema,
      scenarioId: IdSchema,
      provenance: FixtureProvenanceSchema,
      /** Required (non-null) only when provenance claims a captured model response. */
      model: z.string().max(64).nullable(),
      capturedAtUtc: TimestampSchema.nullable(),
      notes: z.string().min(1).max(1000),
      proposal,
    })
    .superRefine((fixture, ctx) => {
      if (fixture.provenance === "captured_gpt_5_6") {
        if (!fixture.model || !fixture.capturedAtUtc) {
          ctx.addIssue({
            code: "custom",
            path: ["provenance"],
            message: "captured fixtures must evidence model and capturedAtUtc metadata",
          });
        }
      } else if (fixture.model !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["model"],
          message: "authored fixtures must not claim a model",
        });
      }
    });

  return { operation, proposal, replayFixture };
}

const defaults = makeProposalSchemas(JsonValueSchema);

/** Permissive defaults: any JSON value. Domains re-derive stricter versions. */
export const ChangeOperationSchema = defaults.operation;
export const ChangeProposalSchema = defaults.proposal;
export const ReplayFixtureSchema = defaults.replayFixture;

export type ChangeOpKind = z.infer<typeof ChangeOpKindSchema>;
export type VerificationStep = z.infer<typeof VerificationStepSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
export type { AnalysisMode, FixtureProvenance } from "./analysis";
