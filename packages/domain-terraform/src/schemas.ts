import { EvidenceIdSchema, IdSchema, JsonValueSchema } from "@changesafe/core";
import { z } from "zod";

/**
 * The subset of `terraform show -json <plan>` that ChangeSafe polices.
 *
 * The envelope is deliberately loose: Terraform adds fields across versions
 * and providers, and rejecting a plan because it carries something new would
 * fail closed in the wrong direction — the operator would simply stop using
 * the gate. Everything we normalize into is strict.
 */

/** Raw Terraform actions, including the two-element forms that mean "replace". */
export const TerraformActionSchema = z.enum([
  "no-op",
  "create",
  "read",
  "update",
  "delete",
]);

export const TerraformResourceChangeSchema = z.looseObject({
  address: z.string().min(1).max(512),
  module_address: z.string().max(512).optional(),
  mode: z.string().max(32).optional(),
  type: z.string().min(1).max(128),
  name: z.string().max(256).optional(),
  change: z.looseObject({
    actions: z.array(TerraformActionSchema).min(1).max(2),
    before: JsonValueSchema.nullable().optional(),
    after: JsonValueSchema.nullable().optional(),
    after_unknown: JsonValueSchema.nullable().optional(),
  }),
});

export const TerraformPlanSchema = z.looseObject({
  format_version: z.string().max(16).optional(),
  terraform_version: z.string().max(32).optional(),
  resource_changes: z.array(TerraformResourceChangeSchema).max(5000).optional(),
});

export type TerraformPlan = z.infer<typeof TerraformPlanSchema>;
export type TerraformResourceChange = z.infer<typeof TerraformResourceChangeSchema>;

// ---------------------------------------------------------------------------
// The normalized model policies actually read
// ---------------------------------------------------------------------------

export const PlannedActionSchema = z.enum([
  "create",
  "update",
  "delete",
  "replace",
  "read",
  "no-op",
]);

export const PlannedChangeSchema = z.strictObject({
  /** Stable evidence id derived from the plan's own ordering. */
  evidenceId: EvidenceIdSchema,
  /** Full Terraform address, e.g. module.db.aws_db_instance.main */
  address: z.string().min(1).max(512),
  /** Address slug usable in a state path (kebab-case, collision-free). */
  slug: z.string().min(1).max(512),
  resourceType: z.string().min(1).max(128),
  moduleAddress: z.string().max(512),
  action: PlannedActionSchema,
  before: JsonValueSchema.nullable(),
  after: JsonValueSchema.nullable(),
  /** Tags read from the planned state, used by protected-resource matching. */
  tags: z.record(z.string(), z.string()),
});

/** Free text that travelled with the change: a PR body, a commit message. */
export const PlanContextEntrySchema = z.strictObject({
  evidenceId: EvidenceIdSchema,
  kind: z.string().min(1).max(64),
  text: z.string().min(1).max(20000),
});

export const TerraformInputSchema = z.strictObject({
  /** Identifier for this plan; derived from the file or supplied by the caller. */
  planId: IdSchema,
  terraformVersion: z.string().max(32).nullable(),
  changes: z.array(PlannedChangeSchema).max(5000),
  context: z.array(PlanContextEntrySchema).max(64),
});

export type PlannedAction = z.infer<typeof PlannedActionSchema>;
export type PlannedChange = z.infer<typeof PlannedChangeSchema>;
export type PlanContextEntry = z.infer<typeof PlanContextEntrySchema>;
export type TerraformInput = z.infer<typeof TerraformInputSchema>;

// ---------------------------------------------------------------------------
// Terraform policy pack
// ---------------------------------------------------------------------------

/**
 * Terraform-specific knobs. Like core's pack, this is data — patterns and
 * lists, never expressions — so a pack can tighten or loosen the gate but
 * cannot change how it reasons.
 */
export const TerraformPolicyPackSchema = z.strictObject({
  /**
   * Resource types whose destruction loses data rather than just capacity.
   * Matched as case-insensitive substrings of the resource type.
   */
  statefulResourcePatterns: z.array(z.string().min(2).max(64)).max(200).optional(),
  /** Address prefixes/globs that may never be destroyed or replaced. */
  protectedAddressPatterns: z.array(z.string().min(1).max(256)).max(200).optional(),
  /** A resource carrying this tag set to "true" is treated as protected. */
  protectedTag: z.string().min(1).max(64).optional(),
  /** A resource carrying this tag is accepted as having a recoverable backup. */
  backupTag: z.string().min(1).max(64).optional(),
});

export type TerraformPolicyPack = z.infer<typeof TerraformPolicyPackSchema>;

export interface ResolvedTerraformPack {
  statefulResourcePatterns: string[];
  protectedAddressPatterns: string[];
  protectedTag: string;
  backupTag: string;
}

/**
 * Defaults chosen to be loud about data loss and quiet about ordinary churn.
 * Substring matching keeps them provider-agnostic: `aws_db_instance`,
 * `google_sql_database_instance`, and `azurerm_mssql_database` all contain
 * a listed fragment.
 */
export const DEFAULT_TERRAFORM_PACK: ResolvedTerraformPack = {
  statefulResourcePatterns: [
    "_db_",
    "_rds_",
    "_database",
    "_sql_",
    "_dynamodb_table",
    "_s3_bucket",
    "_storage_bucket",
    "_blob_container",
    "_volume",
    "_disk",
    "_filesystem",
    "_efs_",
    "_elasticache",
    "_redis",
    "_kafka",
    "_secret",
    "_kms_key",
    "_backup_",
    "_snapshot",
  ],
  protectedAddressPatterns: [],
  protectedTag: "changesafe_protected",
  backupTag: "changesafe_backup",
};

export function resolveTerraformPack(
  pack?: TerraformPolicyPack | null,
): ResolvedTerraformPack {
  return {
    statefulResourcePatterns:
      pack?.statefulResourcePatterns ?? DEFAULT_TERRAFORM_PACK.statefulResourcePatterns,
    protectedAddressPatterns:
      pack?.protectedAddressPatterns ?? DEFAULT_TERRAFORM_PACK.protectedAddressPatterns,
    protectedTag: pack?.protectedTag ?? DEFAULT_TERRAFORM_PACK.protectedTag,
    backupTag: pack?.backupTag ?? DEFAULT_TERRAFORM_PACK.backupTag,
  };
}
