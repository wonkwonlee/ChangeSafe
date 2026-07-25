import { z } from "zod";
import { deriveRiskLevel, PolicyIdSchema, PolicyStatusSchema, RiskLevelSchema } from "./findings";
import { IdSchema } from "./primitives";

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
  });

export type ScenarioExpectations = z.infer<typeof ScenarioExpectationsSchema>;
