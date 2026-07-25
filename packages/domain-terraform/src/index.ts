/**
 * @changesafe/domain-terraform — gate `terraform show -json` plan output.
 *
 * An external-diff domain: Terraform computed the diff, so ChangeSafe reads
 * it rather than simulating. It never runs Terraform, never touches state,
 * and never applies anything — plan JSON in, findings out.
 */

export { createTerraformDomain, terraformDomain, POLICY_VERSION, TERRAFORM_POLICY_VERSION } from "./adapter";
export { deriveProposal, normalizePlan, TerraformChangeProposalSchema } from "./normalize";
export type { NormalizeOptions } from "./normalize";
export {
  evaluateDestructiveOp,
  evaluateProtectedResource,
  evaluateReversibility,
  isProtected,
  isStateful,
  matchesAddress,
} from "./policies";
export type { TerraformPolicyContext, TerraformPolicyDeps } from "./policies";
export {
  DEFAULT_TERRAFORM_PACK,
  PlannedChangeSchema,
  TerraformInputSchema,
  TerraformPlanSchema,
  TerraformPolicyPackSchema,
  resolveTerraformPack,
} from "./schemas";
export type {
  PlanContextEntry,
  PlannedAction,
  PlannedChange,
  ResolvedTerraformPack,
  TerraformInput,
  TerraformPlan,
  TerraformPolicyPack,
} from "./schemas";
