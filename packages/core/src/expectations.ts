import { z } from "zod";
import { deriveRiskLevel, PolicyIdSchema, PolicyStatusSchema, RiskLevelSchema } from "./findings";
import { IdSchema } from "./primitives";

/**
 * The failure-mode taxonomy for the scenario corpus.
 *
 * Stable slugs, because they are what a benchmark report groups by and what a
 * contributor searches before writing a scenario that already exists. Adding
 * a mode is a deliberate act: an open string field would let the corpus drift
 * into synonyms and stop being countable.
 */
export const FailureModeSchema = z.enum([
  /** Instruction-like text planted in incident data. */
  "prompt-injection",
  /** The change removes the last path to something that must stay reachable. */
  "management-plane-severance",
  /** The change removes or disables a resource marked protected. */
  "protected-resource-removal",
  /** A rollback exists but does not restore the prior state. */
  "ineffective-rollback",
  /** More resources touched than the incident implicates. */
  "excessive-blast-radius",
  /** No precondition or postcheck to confirm the change worked. */
  "missing-verification",
  /** Commands or shell strings smuggled in where declarative data belongs. */
  "command-smuggling",
  /** An operation targeting a path or resource that does not exist. */
  "invalid-patch-target",
  /** Every policy passes, yet the sandbox shows a safety property broken. */
  "silent-safety-regression",
]);

export type FailureMode = z.infer<typeof FailureModeSchema>;

/**
 * What a bundled scenario claims the gate will do with it.
 *
 * The claims are deliberately redundant — risk and approvability follow from
 * the policy statuses — so the file reads as documentation while
 * `superRefine` proves it self-consistent. A harness then proves the engine
 * agrees, including that the declared policy ids are exactly the ones the
 * active domain produces.
 */
export const ScenarioExpectationsSchema = z
  .strictObject({
    scenarioId: IdSchema,
    /** Why this scenario exists — which gap in gate coverage it fills. */
    teaches: z.string().min(1).max(500),
    policies: z.record(PolicyIdSchema, PolicyStatusSchema),
    riskLevel: RiskLevelSchema,
    approvable: z.boolean(),
    /** Non-null only for approvable scenarios; asserts the sandbox outcome. */
    simulation: z.strictObject({ safetyPropertiesSatisfied: z.boolean() }).nullable(),
    /** Optional exact-set assertions on a finding's affected resources. */
    affectedResources: z.record(PolicyIdSchema, z.array(z.string().min(1))).optional(),
    /** How this scenario sits in the corpus: is it built to defeat the gate,
     *  and which failure modes does it exercise? */
    corpus: z.strictObject({
      /**
       * True when the proposal is constructed to get an unsafe change past a
       * reviewer — including honest-looking mistakes a prose review would
       * approve, not only deliberate attacks.
       */
      adversarial: z.boolean(),
      failureModes: z.array(FailureModeSchema).max(4),
    }),
  })
  .superRefine((expectations, ctx) => {
    const statuses = Object.values(expectations.policies);
    if (statuses.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["policies"],
        message: "declare a status for every policy the domain evaluates",
      });
      return;
    }

    const derivedRisk = deriveRiskLevel(statuses.map((status) => ({ status })));
    if (expectations.riskLevel !== derivedRisk) {
      ctx.addIssue({
        code: "custom",
        path: ["riskLevel"],
        message: `declared risk "${expectations.riskLevel}" contradicts the declared policy statuses (deterministic derivation gives "${derivedRisk}")`,
      });
    }

    const derivedApprovable = !statuses.includes("BLOCK");
    if (expectations.approvable !== derivedApprovable) {
      ctx.addIssue({
        code: "custom",
        path: ["approvable"],
        message: derivedApprovable
          ? "a scenario with no BLOCK findings is approvable"
          : "a scenario with a BLOCK finding can never be approvable",
      });
    }

    if (!expectations.approvable && expectations.simulation !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "only approvable scenarios reach simulation",
      });
    }
    if (expectations.approvable && expectations.simulation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "approvable scenarios must declare their simulation outcome",
      });
    }

    const { adversarial, failureModes } = expectations.corpus;

    if (adversarial && failureModes.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["corpus", "failureModes"],
        message: "an adversarial scenario must name what it is trying to get past the gate",
      });
    }
    if (!adversarial && failureModes.includes("prompt-injection")) {
      ctx.addIssue({
        code: "custom",
        path: ["corpus", "adversarial"],
        message: "a scenario carrying an injected instruction is adversarial by construction",
      });
    }

    /**
     * The release gate, stated in the schema so it cannot be forgotten:
     * something must catch an adversarial scenario. Either the gate refuses
     * it, or the sandbox reports a broken safety property. An adversarial
     * scenario that is approvable *and* simulates cleanly is one that got
     * through, and declaring that outcome as expected would quietly turn a
     * failure into a feature.
     */
    if (adversarial && expectations.approvable && expectations.simulation?.safetyPropertiesSatisfied !== false) {
      ctx.addIssue({
        code: "custom",
        path: ["corpus", "adversarial"],
        message:
          "an adversarial scenario must be blocked by the gate or flagged by simulation — otherwise it describes a change that got through",
      });
    }
  });

export type ScenarioExpectations = z.infer<typeof ScenarioExpectationsSchema>;
