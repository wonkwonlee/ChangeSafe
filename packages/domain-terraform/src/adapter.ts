import {
  CORE_POLICY_VERSION,
  DomainError,
  type ChangeOperation,
  type DomainAdapter,
} from "@changesafe/core";

import {
  evaluateDestructiveOp,
  evaluatePlanContextRequired,
  evaluateProtectedResource,
  evaluateReversibility,
  type TerraformPolicyContext,
} from "./policies";
import {
  resolveTerraformPack,
  type TerraformInput,
  type TerraformPolicyPack,
} from "./schemas";

export const TERRAFORM_POLICY_VERSION = "terraform-v0.2.1";
export const POLICY_VERSION = `${CORE_POLICY_VERSION}+${TERRAFORM_POLICY_VERSION}`;

/**
 * The Terraform domain — an **external-diff** domain.
 *
 * Terraform already computed the diff, so nothing here simulates: the plan is
 * the simulation. `applyOperations` therefore validates rather than mutates,
 * which is what keeps core's PATCH_SCHEMA meaningful in this shape ("does
 * every operation correspond to a change the plan actually contains?").
 *
 * ChangeSafe never runs Terraform. It reads plan JSON and nothing else.
 */
export function createTerraformDomain(
  pack?: TerraformPolicyPack | null,
): DomainAdapter<TerraformInput, TerraformInput> {
  const resolved = resolveTerraformPack(pack);
  const deps = { pack: resolved };

  return {
    domainId: "terraform",
    policyVersion: POLICY_VERSION,

    // The "state" is the plan itself; there is nothing else to mutate.
    stateOf: (input) => input,

    applyOperations(state, operations) {
      const byPath = new Map(
        state.changes.map((change) => [`/resources/${change.slug}`, change]),
      );
      const diff = operations.map((operation) => {
        const change = byPath.get(operation.path);
        if (!change) {
          throw new DomainError(
            "PATCH_TARGET_MISSING",
            `no plan entry corresponds to "${operation.path}"`,
          );
        }
        const expected =
          change.action === "create"
            ? "add"
            : change.action === "delete"
              ? "remove"
              : "replace";
        if (operation.op !== expected) {
          throw new DomainError(
            "PATCH_VALUE_INVALID",
            `operation on "${operation.path}" says "${operation.op}" but the plan says "${change.action}"`,
          );
        }
        return {
          op: operation.op,
          path: operation.path,
          before: change.before,
          after: change.after,
        };
      });
      // Returned unchanged on purpose: an external-diff domain has no state
      // to advance, and pretending otherwise would fake a simulation.
      return { nextState: state, diff };
    },

    blastRadiusUnit(operation: ChangeOperation) {
      const slug = operation.path.replace(/^\/resources\//, "");
      return slug === operation.path ? null : { kind: "resource", id: slug };
    },

    untrustedTexts: (input) =>
      input.context.map((entry) => ({
        evidenceId: entry.evidenceId,
        kind: entry.kind,
        text: entry.text,
      })),

    knownEvidenceIds: (input) =>
      new Set([
        ...input.changes.map((change) => change.evidenceId),
        ...input.context.map((entry) => entry.evidenceId),
      ]),

    policies: [
      {
        id: "DESTRUCTIVE_OP",
        evaluate: (context) => evaluateDestructiveOp(context as TerraformPolicyContext, deps),
      },
      {
        id: "PROTECTED_RESOURCE",
        evaluate: (context) => evaluateProtectedResource(context as TerraformPolicyContext, deps),
      },
      {
        id: "REVERSIBILITY",
        evaluate: (context) => evaluateReversibility(context as TerraformPolicyContext, deps),
      },
      {
        id: "PLAN_CONTEXT_REQUIRED",
        evaluate: (context) => evaluatePlanContextRequired(context as TerraformPolicyContext),
      },
    ],

    // A cloud plan touching a dozen resources is ordinary; a dozen routers
    // during an incident is not. Same policy, domain-appropriate thresholds.
    defaultPolicyPack: {
      name: "terraform-defaults",
      blastRadius: { warnAt: 15, blockAbove: 60 },
    },

    skippedUniversalPolicies: [
      {
        policyId: "ROLLBACK_COMPLETE",
        because:
          "a Terraform plan carries no inverse operations to verify; reverting means reverting the code, not replaying a patch",
        replacedBy: { kind: "domain-policy", policyId: "REVERSIBILITY" },
      },
      {
        policyId: "VERIFICATION_REQUIRED",
        because:
          "the proposal is derived mechanically from the plan with no model involved, so it can never declare its own precondition or postcheck steps; verification in this workflow happens through the pull request review instead",
        replacedBy: { kind: "domain-policy", policyId: "PLAN_CONTEXT_REQUIRED" },
      },
    ],
  };
}

/** The domain with default thresholds; most callers want this. */
export const terraformDomain = createTerraformDomain();
