import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isDomainError } from "@changesafe/core";
import { PlannedChangeSchema, TerraformPlanSchema } from "@changesafe/domain-terraform";
import { deriveReviewedGrantBinding } from "../../packages/server/src/grant-binding";
import {
  completeExact, evaluate, summarize, v2a, v2b, type AuditEdit, type Coverage, type History, type PriorKnowledge,
} from "./m4-evidence-model";

/**
 * M4 experiment 08 (docs/M4_EXPERIMENT_08.md): does the structure the
 * observation contract rests on exist in Terraform, and does the artifact
 * ChangeSafe ingests there carry it? Nothing here runs Terraform or touches
 * a cloud. The documented `terraform show -json` formats are read in the
 * note; this file checks what the repo itself ingests and decides.
 */

const SCENARIOS = path.resolve("scenarios/terraform");

/** Every key name at any depth of a JSON value. */
function keyNames(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keyNames(child, into);
    }
  }
  return into;
}

const scenarioNames = readdirSync(SCENARIOS).filter(name => name.startsWith("scenario-"));
const inputs = scenarioNames.map(name => ({
  name,
  value: z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path.join(SCENARIOS, name, "incident.json"), "utf8"))),
}));
const WithChanges = z.object({
  resource_changes: z.array(z.object({
    change: z.object({
      before: z.object({ tags: z.unknown().optional() }).passthrough().nullable().optional(),
      after: z.object({ tags: z.unknown().optional() }).passthrough().nullable().optional(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

describe("M4-08 H8a: what the ingested Terraform artifact carries", () => {
  it("covers all seven committed Terraform inputs, each a plan envelope the schema accepts", () => {
    expect(inputs).toHaveLength(7);
    for (const input of inputs) expect(TerraformPlanSchema.safeParse(input.value).success).toBe(true);
  });

  it("none of them carries a state serial, a lineage, or a prior_state", () => {
    for (const input of inputs) {
      const keys = keyNames(input.value);
      for (const forbidden of ["serial", "lineage", "prior_state"]) {
        expect([input.name, keys.has(forbidden)]).toEqual([input.name, false]);
      }
    }
  });

  it("the keys they do carry are the envelope and resource changes, no per-object version", () => {
    const topLevel = new Set(inputs.flatMap(input => Object.keys(input.value)));
    expect([...topLevel].sort()).toEqual(["context", "format_version", "resource_changes", "terraform_version"]);
    for (const input of inputs) {
      const keys = keyNames(input.value);
      for (const versionLike of ["resourceVersion", "generation", "etag", "version_id", "revision"]) {
        expect(keys.has(versionLike)).toBe(false);
      }
    }
  });

  it("the normalized model the policies read has no incarnation or version field either", () => {
    // PlannedChange is what the domain keeps: address, type, action, before,
    // after, tags. Its keys are the whole of what ChangeSafe could bind.
    expect(Object.keys(PlannedChangeSchema.shape).sort()).toEqual([
      "action", "address", "after", "before", "evidenceId", "moduleAddress", "resourceType", "slug", "tags",
    ]);
  });
});

describe("M4-08 H8b: nothing in the artifact can play the carrier", () => {
  it("the only candidate field, tags, lives in the same before/after values anyone who writes the resource writes", () => {
    // Tags are part of the resource's own configuration. The grant carrier
    // needs a field only the authorizing boundary can set; a tag is set by
    // whoever can write the configuration or the resource. This is the
    // property of the artifact, shown by where tags appear.
    const withTags = inputs.flatMap(input =>
      WithChanges.parse(input.value).resource_changes.filter(change =>
        change.change.before?.tags !== undefined || change.change.after?.tags !== undefined));
    expect(withTags.length).toBeGreaterThan(0);
    expect(Object.keys(PlannedChangeSchema.shape)).toContain("tags");
    expect(Object.keys(PlannedChangeSchema.shape).filter(key => /grant|receipt|carrier|authoriz/i.test(key))).toEqual([]);
  });
});

describe("M4-08 H8c: the contract with no unforgeable carrier", () => {
  const scopeDefault = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && h.tier === "default";

  it("returns no 'stored' verdict at all, from either repair", () => {
    // Terraform has no boundary that sets a carrier, so the precondition is
    // false: the model's "assume the carrier unforgeable" flag is off.
    for (const contract of [v2a, v2b]) {
      const rows = evaluate(contract, scopeDefault, () => false);
      expect(rows.some(row => row.verdict === "stored")).toBe(false);
      expect(summarize(rows).unsound).toEqual([]);
    }
  });

  it("its definite verdicts are absence ('rejected') and 'not_consumed', and nothing about a write that was stored", () => {
    const rows = evaluate(v2b, scopeDefault, () => false);
    const definite = rows.filter(row => row.verdict !== "unknown");
    expect(new Set(definite.map(row => row.verdict))).toEqual(new Set(["rejected", "not_consumed"]));
    const storedTruth = rows.filter(row => row.truth === "stored");
    expect(storedTruth.length).toBeGreaterThan(0);
    expect(storedTruth.every(row => row.verdict === "unknown")).toBe(true);
  });
});

describe("M4-08 H8d: where an AuthorizationGrant can be issued", () => {
  it("refuses a Terraform review: only Kubernetes has a reviewed grant issuance contract", async () => {
    const request = {
      domain: "terraform",
      sourceId: "src-terraform-plan",
      input: inputs[0]?.value,
      decision: "approve" as const,
    };
    let caught: unknown;
    try {
      await deriveReviewedGrantBinding(request);
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught)).toBe(true);
    expect(caught instanceof Error ? caught.message : "").toContain("Only Kubernetes has a reviewed grant issuance contract");
  });

  it("the network domain is refused the same way", async () => {
    let caught: unknown;
    try {
      await deriveReviewedGrantBinding({ domain: "network", sourceId: "src-network", input: {}, decision: "approve" });
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught)).toBe(true);
  });
});
