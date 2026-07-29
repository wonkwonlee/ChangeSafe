import destroysDatabasePlan from "../../../packages/domain-terraform/tests/fixtures/destroys-database.tfplan.json";
import protectedAndInjectedPlan from "../../../packages/domain-terraform/tests/fixtures/protected-and-injected.tfplan.json";
import safeScaleUpPlan from "../../../packages/domain-terraform/tests/fixtures/safe-scale-up.tfplan.json";

import type { NormalizeOptions } from "@changesafe/domain-terraform";

import { INJECTED_PULL_REQUEST_BODY } from "./injected-pr-body";

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
    | "terraform-protected-and-injected";
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
  ]);
