import {
  ScenarioExpectationsSchema,
  type ChangeProposal,
  type ScenarioExpectations,
} from "@changesafe/core";
import {
  deriveProposal,
  normalizePlan,
  type TerraformInput,
} from "@changesafe/domain-terraform";

import planJ from "./terraform/scenario-j-destroy-protected/incident.json";
import expectationsJ from "./terraform/scenario-j-destroy-protected/expectations.json";
import planK from "./terraform/scenario-k-capacity-scale-up/incident.json";
import expectationsK from "./terraform/scenario-k-capacity-scale-up/expectations.json";
import planN from "./terraform/scenario-n-stateless-replace/incident.json";
import expectationsN from "./terraform/scenario-n-stateless-replace/expectations.json";
import planO from "./terraform/scenario-o-stateful-replace-backed-up/incident.json";
import expectationsO from "./terraform/scenario-o-stateful-replace-backed-up/expectations.json";
import planP from "./terraform/scenario-p-injected-pr-context/incident.json";
import expectationsP from "./terraform/scenario-p-injected-pr-context/expectations.json";
import planT from "./terraform/scenario-t-blast-radius-drift/incident.json";
import expectationsT from "./terraform/scenario-t-blast-radius-drift/expectations.json";
import planU from "./terraform/scenario-u-unrecorded-prior-state/incident.json";
import expectationsU from "./terraform/scenario-u-unrecorded-prior-state/expectations.json";

/**
 * Terraform-only scenario registry, deliberately independent of
 * `scenarios/domains.ts` (which statically imports every domain package).
 * `components/TerraformWorkbenchShell.tsx` and the other files reachable from
 * `app/workbench/terraform/page.tsx` import this module rather than
 * `scenarios/index.ts`, so the Terraform public workbench route's static
 * bundle never pulls in `@changesafe/domain-network` or
 * `@changesafe/domain-kubernetes` — see
 * `tests/unit/workbench-performance-boundaries.test.ts`.
 *
 * `fixture` is always null: Terraform is an external-diff domain, so the plan
 * already is the proposal and there is no authored-or-captured replay fixture
 * to declare provenance for.
 */
export interface TerraformScenarioDefinition {
  scenarioId: string;
  domainId: "terraform";
  /** Incident-styled label — describes the situation, never the expected verdict. */
  label: string;
  shortDescription: string;
  input: TerraformInput;
  inputId: string;
  proposal: ChangeProposal;
  fixture: null;
  /** The machine-checked contract this scenario claims; see tests/integration. */
  expectations: ScenarioExpectations;
}

function defineTerraformScenario(
  scenarioId: string,
  label: string,
  shortDescription: string,
  rawInput: unknown,
  rawExpectations: unknown,
): TerraformScenarioDefinition {
  // `context` is carried alongside the plan in `incident.json` but is not part
  // of `terraform show -json` output, so it is destructured off and passed as
  // a normalize option — matching `scenarios/domains.ts` and
  // `packages/cli/src/domains.ts`. Keep all three in sync.
  const { context, ...plan } = rawInput as {
    context?: { kind: string; text: string }[];
  } & Record<string, unknown>;
  const input = normalizePlan(plan, { context, planId: scenarioId });
  const expectations = ScenarioExpectationsSchema.parse(rawExpectations);
  if (expectations.scenarioId !== scenarioId) {
    throw new Error(
      `expectations declare scenario "${expectations.scenarioId}", expected "${scenarioId}"`,
    );
  }
  return {
    scenarioId,
    domainId: "terraform",
    label,
    shortDescription,
    input,
    inputId: input.planId,
    proposal: deriveProposal(input),
    fixture: null,
    expectations,
  };
}

/**
 * Picker order, mirroring `scenarios/network.ts`: the cleanest approvable plan
 * first, then ascending severity, with the adversarial plans last. The public
 * workbench lands on element zero, so a red-team plan here would make "the
 * gate refuses things" the first and only thing a visitor sees.
 */
export const TERRAFORM_SCENARIOS: readonly TerraformScenarioDefinition[] = [
  defineTerraformScenario(
    "scenario-k-capacity-scale-up",
    "CHG-2340 — Scale up the checkout worker instance",
    "An instance-type bump plus a new CPU alarm for the checkout fleet; nothing is destroyed or replaced.",
    planK,
    expectationsK,
  ),
  defineTerraformScenario(
    "scenario-n-stateless-replace",
    "CHG-2410 — Recreate the checkout worker instance for an AMI update",
    "A routine AMI bump forces Terraform to replace the checkout worker instance in place; nothing stateful is touched.",
    planN,
    expectationsN,
  ),
  defineTerraformScenario(
    "scenario-o-stateful-replace-backed-up",
    "CHG-2418 — Resize the checkout read replica instance class",
    "An instance-class bump forces the checkout read replica to be destroyed and recreated; it is tagged as backed up.",
    planO,
    expectationsO,
  ),
  defineTerraformScenario(
    "scenario-t-blast-radius-drift",
    "CHG-2431 — Bump instance type across the worker fleet",
    "A capacity change replaces twenty worker instances fleet-wide, well beyond a single-service scope.",
    planT,
    expectationsT,
  ),
  defineTerraformScenario(
    "scenario-j-destroy-protected",
    "CHG-2201 — Retire an unused RDS instance",
    "A cleanup plan destroys what looks like an idle database, but it is tagged as the primary datastore.",
    planJ,
    expectationsJ,
  ),
  defineTerraformScenario(
    "scenario-p-injected-pr-context",
    "CHG-2422 — Retire an idle billing database replica",
    "A cleanup PR destroys a protected billing database; its description urges skipping review.",
    planP,
    expectationsP,
  ),
  defineTerraformScenario(
    "scenario-u-unrecorded-prior-state",
    "CHG-2437 — Remove an unused archive logs bucket",
    "A plan to delete an S3 bucket carries no recorded prior state for it.",
    planU,
    expectationsU,
  ),
];

export function getTerraformScenario(
  scenarioId: string,
): TerraformScenarioDefinition | undefined {
  return TERRAFORM_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
