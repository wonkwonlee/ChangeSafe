import {
  DomainError,
  makeProposalSchemas,
  JsonValueSchema,
  type ChangeOperation,
  type ChangeProposal,
  type JsonValue,
} from "@changesafe/core";

import {
  TerraformInputSchema,
  TerraformPlanSchema,
  type PlanContextEntry,
  type PlannedAction,
  type PlannedChange,
  type TerraformInput,
  type TerraformResourceChange,
} from "./schemas";

/**
 * A plan legitimately contains hundreds of changes, unlike a model-authored
 * proposal, so this domain raises core's conservative limits.
 */
const terraformProposalSchemas = makeProposalSchemas(JsonValueSchema, {
  maxOperations: 2000,
  maxEvidenceIdsPerClaim: 2000,
});

export const TerraformChangeProposalSchema = terraformProposalSchemas.proposal;

/** Terraform's two-element action arrays are the only way it expresses replace. */
function normalizeAction(actions: string[]): PlannedAction {
  if (actions.length === 2) return "replace";
  const [action] = actions;
  switch (action) {
    case "create":
    case "update":
    case "delete":
    case "read":
      return action;
    default:
      return "no-op";
  }
}

/** Address → path segment. Collisions are disambiguated by the caller. */
function slugify(address: string): string {
  const slug = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "resource";
}

function readTags(value: JsonValue | null | undefined): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const tags: Record<string, string> = {};
  for (const key of ["tags", "labels", "tags_all"]) {
    const candidate = value[key];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    for (const [tagKey, tagValue] of Object.entries(candidate)) {
      if (typeof tagValue === "string") tags[tagKey] = tagValue;
    }
  }
  return tags;
}

export interface NormalizeOptions {
  /** Identifier for this plan; defaults to a stable placeholder. */
  planId?: string;
  /** Untrusted free text that travelled with the change (a PR body). */
  context?: { kind: string; text: string }[];
}

/**
 * Turn raw `terraform show -json` output into the model the gate reasons
 * about.
 *
 * This domain never simulates: Terraform already computed the diff, so the
 * plan *is* the simulation. Normalizing is the whole job — decide what each
 * change does, what it touches, and what evidence backs it.
 *
 * No-op and read changes are dropped: they alter nothing, and counting them
 * would inflate blast radius with noise.
 */
export function normalizePlan(raw: unknown, options: NormalizeOptions = {}): TerraformInput {
  const parsed = TerraformPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(
      "SCHEMA_VALIDATION",
      "The file is not recognizable Terraform plan JSON. Produce it with: terraform show -json <planfile>",
    );
  }

  const resourceChanges: TerraformResourceChange[] = parsed.data.resource_changes ?? [];
  const seenSlugs = new Map<string, number>();
  const changes: PlannedChange[] = [];

  resourceChanges.forEach((resource, index) => {
    const action = normalizeAction(resource.change.actions);
    if (action === "no-op" || action === "read") return;

    const base = slugify(resource.address);
    const seen = seenSlugs.get(base) ?? 0;
    seenSlugs.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen + 1}`;

    const after = resource.change.after ?? null;
    const before = resource.change.before ?? null;

    changes.push({
      // Evidence for "we are deleting the database" is the plan entry itself.
      evidenceId: `ev-plan-${index}`,
      address: resource.address,
      slug,
      resourceType: resource.type,
      moduleAddress: resource.module_address ?? "root",
      action,
      before,
      after,
      // The resource being destroyed is `before`; `after` is what replaces
      // it in a "replace" action. Merging them let a replacement's tags
      // (fully attacker-controlled in a proposed plan) override the tags of
      // the resource actually being destroyed — a fabricated backup/
      // protection tag on `after` would satisfy `hasBackup`/`isProtected`
      // for a destroy the tag never applied to. Only the prior state
      // describes what is actually being lost, so `after` is a fallback for
      // pure creates (no `before`), never an override.
      tags: readTags(before ?? after),
    });
  });

  const context: PlanContextEntry[] = (options.context ?? []).map((entry, index) => ({
    evidenceId: `ev-context-${index}`,
    kind: entry.kind,
    text: entry.text,
  }));

  return TerraformInputSchema.parse({
    planId: options.planId ?? "plan-terraform",
    terraformVersion: parsed.data.terraform_version ?? null,
    changes,
    context,
  });
}

const ACTION_TO_OP: Record<Exclude<PlannedAction, "no-op" | "read">, ChangeOperation["op"]> = {
  create: "add",
  update: "replace",
  delete: "remove",
  replace: "replace",
};

/**
 * Derive the proposal the gate evaluates.
 *
 * Nothing here is authored by a model: the plan already states what will
 * happen, and this is a faithful restatement in the gate's vocabulary. The
 * diagnosis says so plainly rather than inventing reasoning.
 */
export function deriveProposal(input: TerraformInput): ChangeProposal {
  if (input.changes.length === 0) {
    throw new DomainError(
      "REQUEST_INVALID",
      "The plan contains no create, update, delete, or replace actions — there is nothing to gate.",
    );
  }

  const operations: ChangeOperation[] = input.changes.map((change) => ({
    op: ACTION_TO_OP[change.action as Exclude<PlannedAction, "no-op" | "read">],
    path: `/resources/${change.slug}`,
    value: change.action === "delete" ? null : change.after,
    reason: `Terraform plans to ${change.action} ${change.address}`.slice(0, 500),
    evidenceIds: [change.evidenceId],
  }));

  const counts = new Map<PlannedAction, number>();
  for (const change of input.changes) {
    counts.set(change.action, (counts.get(change.action) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([action, count]) => `${count} ${action}`)
    .join(", ");

  return TerraformChangeProposalSchema.parse({
    proposalId: "prop-terraform-plan",
    summary: `Terraform plan: ${summary}.`,
    diagnosis: {
      likelyCause:
        "Derived mechanically from Terraform plan output. No model produced this diagnosis; the plan states what will change and this restates it for the gate.",
      // Advisory field, unused by every policy. Zero is the honest value for
      // a mechanical derivation that made no judgement.
      confidence: 0,
      evidenceIds: input.changes.map((change) => change.evidenceId),
      assumptions: [
        "The plan was produced from the code under review against current state",
        "Provider behaviour matches what the plan reports",
      ],
    },
    operations,
    // Terraform plans carry no inverse; REVERSIBILITY answers that question
    // instead, and this domain skips ROLLBACK_COMPLETE for exactly that reason.
    rollbackOperations: [],
    verificationSteps: [],
  });
}
