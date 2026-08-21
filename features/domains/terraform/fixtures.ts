import { normalizePlan, type TerraformInput } from "@changesafe/domain-terraform";

import {
  TERRAFORM_SCENARIOS,
  type TerraformScenarioDefinition,
} from "../../../scenarios/terraform";

export const LARGE_TERRAFORM_CHANGE_COUNT = 10;

const largeConfigurationNote =
  "fictional-boundary-setting-".repeat(60);

const largeBoundaryPlan = Object.freeze({
  format_version: "1.2",
  terraform_version: "1.9.5",
  resource_changes: Object.freeze(
    Array.from({ length: LARGE_TERRAFORM_CHANGE_COUNT }, (_, index) => {
      const suffix = index.toString().padStart(3, "0");
      return Object.freeze({
        address: `module.boundary.aws_instance.worker_${suffix}`,
        module_address: "module.boundary",
        mode: "managed",
        type: "aws_instance",
        name: `worker_${suffix}`,
        provider_name: "registry.terraform.io/hashicorp/aws",
        change: Object.freeze({
          actions: Object.freeze(["update"]),
          before: Object.freeze({
            instance_type: "t3.small",
            configuration_note: largeConfigurationNote,
            tags: Object.freeze({
              Name: `fictional-boundary-worker-${suffix}`,
              Environment: "demo",
            }),
          }),
          after: Object.freeze({
            instance_type: "t3.medium",
            configuration_note: largeConfigurationNote,
            tags: Object.freeze({
              Name: `fictional-boundary-worker-${suffix}`,
              Environment: "demo",
              ReviewedBy: "changesafe-offline-fixture",
            }),
          }),
        }),
      });
    }),
  ),
});

/**
 * A public replay entry point for the Terraform workbench: an already-normalized
 * fictional plan plus the provenance the UI must state about it.
 *
 * The normalized `input` is the single authority for both the picker and
 * `app/api/reviews/analyze/route.ts`, so the client's `expectedInputId` check
 * compares two views of the same value rather than two independent
 * normalizations that could drift.
 */
export interface TerraformPublicReplayFixture {
  readonly sourceId: string;
  readonly inputId: string;
  readonly label: string;
  readonly description: string;
  readonly provenance: "authored-synthetic" | "authored-red-team";
  readonly input: TerraformInput;
}

/**
 * Terraform is external-diff, so a scenario carries no replay fixture whose
 * provenance could be read. `corpus.adversarial` is the corpus's own honest
 * declaration of whether the plan was authored as a red-team artifact.
 */
export function scenarioReplayProvenance(
  scenario: TerraformScenarioDefinition,
): TerraformPublicReplayFixture["provenance"] {
  return scenario.expectations.corpus.adversarial
    ? "authored-red-team"
    : "authored-synthetic";
}

function scenarioFixture(
  scenario: TerraformScenarioDefinition,
): TerraformPublicReplayFixture {
  return Object.freeze({
    sourceId: scenario.scenarioId,
    inputId: scenario.inputId,
    label: scenario.label,
    description: scenario.shortDescription,
    provenance: scenarioReplayProvenance(scenario),
    input: scenario.input,
  });
}

/**
 * Every fictional Terraform plan the public workbench can replay.
 *
 * The scenario corpus (`scenarios/terraform/*`) is the content: adding a
 * scenario there surfaces it here with no change to this file. The one
 * remaining hand-authored fixture is structural rather than narrative: every
 * one of its changes carries an oversized value, which is what forces the
 * per-value JSON preview to truncate. `scenario-t-blast-radius-drift` already
 * pushes past `MAX_VISIBLE_OFFLINE_ITEMS` on change *count*, but its
 * individual values are small, so the two bounds are proven by different
 * inputs. None of these are ever uploaded, fetched, or executed.
 */
export const TERRAFORM_PUBLIC_REPLAY_FIXTURES: readonly TerraformPublicReplayFixture[] =
  Object.freeze([
    ...TERRAFORM_SCENARIOS.map(scenarioFixture),
    Object.freeze({
      sourceId: "terraform-large-plan-boundary",
      inputId: "terraform-large-plan-boundary",
      label: "Large plan boundary",
      description:
        "A fictional 10-change plan with large values that proves bounded, searchable external-diff presentation.",
      provenance: "authored-synthetic" as const,
      input: normalizePlan(largeBoundaryPlan, {
        planId: "terraform-large-plan-boundary",
      }),
    }),
  ]);
