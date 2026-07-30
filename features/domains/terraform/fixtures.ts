import destroysDatabasePlan from "../../../packages/domain-terraform/tests/fixtures/destroys-database.tfplan.json";
import protectedAndInjectedPlan from "../../../packages/domain-terraform/tests/fixtures/protected-and-injected.tfplan.json";
import safeScaleUpPlan from "../../../packages/domain-terraform/tests/fixtures/safe-scale-up.tfplan.json";
import scenarioPIncident from "../../../scenarios/terraform/scenario-p-injected-pr-context/incident.json";

import type { NormalizeOptions } from "@changesafe/domain-terraform";

import { INJECTED_PULL_REQUEST_BODY } from "./injected-pr-body";

export const LARGE_TERRAFORM_CHANGE_COUNT = 10;

const { context: scenarioPContext, ...scenarioPPlan } = scenarioPIncident;

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
 * Fictional Terraform plans used by the public replay workbench.
 *
 * The plans deliberately remain in the Terraform package test-fixture
 * directory so the package and showcase consume one immutable source rather
 * than carrying duplicated JSON that could drift. They are never uploaded,
 * fetched, or executed: this registry only exposes bundled replay inputs.
 */
export interface TerraformPublicReplayFixture {
  readonly sourceId:
    | "terraform-safe-scale-up"
    | "terraform-destroys-database"
    | "terraform-protected-and-injected"
    | "terraform-large-plan-boundary"
    | "scenario-p-injected-pr-context";
  readonly inputId: string;
  readonly label: string;
  readonly description: string;
  readonly provenance: "authored-synthetic" | "authored-red-team";
  readonly plan: unknown;
  readonly context: ReadonlyArray<
    Readonly<NonNullable<NormalizeOptions["context"]>[number]>
  >;
}

export const TERRAFORM_PUBLIC_REPLAY_FIXTURES: readonly TerraformPublicReplayFixture[] =
  Object.freeze([
    Object.freeze({
      sourceId: "terraform-safe-scale-up",
      inputId: "terraform-safe-scale-up",
      label: "Safe scale-up",
      description:
        "A fictional three-resource capacity increase derived from a bundled Terraform plan.",
      provenance: "authored-synthetic",
      plan: safeScaleUpPlan,
      context: [],
    }),
    Object.freeze({
      sourceId: "terraform-destroys-database",
      inputId: "terraform-destroys-database",
      label: "Database destroy",
      description:
        "A fictional Terraform plan that deletes a database and must be blocked by deterministic policy.",
      provenance: "authored-synthetic",
      plan: destroysDatabasePlan,
      context: [],
    }),
    Object.freeze({
      sourceId: "terraform-protected-and-injected",
      inputId: "terraform-protected-and-injected",
      label: "Protected resource with injected PR text",
      description:
        "A fictional red-team plan that replaces protected storage while its bundled PR text attempts to influence review.",
      provenance: "authored-red-team",
      plan: protectedAndInjectedPlan,
      context: Object.freeze([
        Object.freeze({
          kind: "pull request body",
          text: INJECTED_PULL_REQUEST_BODY,
        }),
      ]),
    }),
    Object.freeze({
      sourceId: "terraform-large-plan-boundary",
      inputId: "terraform-large-plan-boundary",
      label: "Large plan boundary",
      description:
        "A fictional 10-change plan with large values that proves bounded, searchable external-diff presentation.",
      provenance: "authored-synthetic",
      plan: largeBoundaryPlan,
      context: [],
    }),
    Object.freeze({
      sourceId: "scenario-p-injected-pr-context",
      inputId: "scenario-p-injected-pr-context",
      label: "Protected billing database, injected PR text",
      description:
        "The exact CHG-2422 scenario featured in the case studies doc: a cleanup PR destroys a protected billing database while its description urges skipping review.",
      provenance: "authored-red-team",
      plan: scenarioPPlan,
      context: scenarioPContext,
    }),
  ]);
