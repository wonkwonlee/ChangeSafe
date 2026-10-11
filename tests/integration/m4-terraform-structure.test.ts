import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isDomainError } from "@changesafe/core";
import { PlannedChangeSchema, TerraformPlanSchema } from "@changesafe/domain-terraform";
import { deriveReviewedGrantBinding } from "../../packages/server/src/grant-binding";
import {
  completeExact, coverages, edits, evaluate, priors, summarize, v2a, v2b,
  type AuditEdit, type Coverage, type History, type PriorKnowledge,
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

  it("the keys they carry are exactly the envelope, the change shape and a few attributes: no version or identity key among them", () => {
    const topLevel = new Set(inputs.flatMap(input => Object.keys(input.value)));
    expect([...topLevel].sort()).toEqual(["context", "format_version", "resource_changes", "terraform_version"]);
    // An allowlist of every key name at any depth, so a new key is noticed.
    const every = new Set(inputs.flatMap(input => [...keyNames(input.value)]));
    expect([...every].sort()).toEqual([
      "actions", "address", "after", "allocated_storage", "ami", "before", "change", "changesafe_backup",
      "changesafe_protected", "context", "engine", "format_version", "identifier", "instance_class",
      "instance_type", "kind", "mode", "module_address", "name", "provider_name", "resource_changes", "service",
      "tags", "terraform_version", "text", "threshold", "type",
    ]);
  });

  it("the normalized model the policies read has no incarnation or version field either", () => {
    // PlannedChange is what the domain keeps: address, type, action, before,
    // after, tags. Its keys are the whole of what ChangeSafe could bind.
    expect(Object.keys(PlannedChangeSchema.shape).sort()).toEqual([
      "action", "address", "after", "before", "evidenceId", "moduleAddress", "resourceType", "slug", "tags",
    ]);
  });
});

describe("M4-08 H8b: nothing in the artifact is set by an authorizing boundary", () => {
  it("what is checkable: tags are ordinary attributes of the resource, and the model has no grant-bound field", () => {
    // The claim that anyone who can write the resource can write its tags is
    // a property of Terraform and the provider, argued in the note; it
    // cannot be read off an artifact. What an artifact can show is that the
    // candidate field sits among the resource's own attributes and that the
    // normalized model has no field a boundary could have set.
    const withTags = inputs.flatMap(input =>
      WithChanges.parse(input.value).resource_changes.filter(change =>
        change.change.before?.tags !== undefined || change.change.after?.tags !== undefined));
    expect(withTags.length).toBeGreaterThan(0);
    expect(Object.keys(PlannedChangeSchema.shape)).toContain("tags");
    expect(Object.keys(PlannedChangeSchema.shape).filter(key => /grant|receipt|carrier|authoriz/i.test(key))).toEqual([]);
  });
});

describe("M4-08 H8c: the contract with no unforgeable carrier", () => {
  // This follows from the contract's precondition being false, which the
  // flag expresses; it is a consequence, not evidence about Terraform. The
  // substantive premise is that the artifact offers no carrier (H8b) and that
  // the default tier is the right stand-in for a Terraform state history,
  // which is an interpretation argued in the note. It is run over the whole
  // default-tier grid, every coverage and every prior, not one slice.
  const defaultTier = (h: History) => h.tier === "default";

  it("returns no 'stored' verdict in any coverage, prior or audit edit, from either repair", () => {
    for (const contract of [v2a, v2b]) {
      const rows = evaluate(contract, defaultTier, () => false);
      expect(rows).toHaveLength(480 * edits.length * coverages.length * priors.length);
      expect(rows.some(row => row.verdict === "stored")).toBe(false);
      expect(summarize(rows).unsound).toEqual([]);
    }
  });

  it("every history in which the write was stored comes back unknown", () => {
    const rows = evaluate(v2b, defaultTier, () => false);
    const storedTruth = rows.filter(row => row.truth === "stored");
    expect(storedTruth.length).toBeGreaterThan(0);
    expect(storedTruth.every(row => row.verdict === "unknown")).toBe(true);
    const definite = rows.filter(row => row.verdict !== "unknown");
    expect(new Set(definite.map(row => row.verdict))).toEqual(new Set(["rejected", "not_consumed"]));
  });

  it("with the carrier assumed instead, the same contract is wrong on a truthful rejection (the cost of assuming it)", () => {
    const scope = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && h.tier === "default";
    expect(summarize(evaluate(v2b, scope, () => true)).unsound.length).toBeGreaterThan(0);
  });
});

describe("M4-08 H8d: where an AuthorizationGrant can be issued", () => {
  const refusal = "REQUEST_INVALID: Only Kubernetes has a reviewed grant issuance contract.";
  async function refused(domain: string): Promise<string> {
    try {
      await deriveReviewedGrantBinding({ domain, sourceId: "src-example", input: inputs[0]?.value, decision: "approve" });
    } catch (error) {
      return isDomainError(error) ? error.message : `not a DomainError: ${String(error)}`;
    }
    return "issued";
  }

  it("refuses Terraform and network with the stated reason, and anything that is not kubernetes the same way", async () => {
    // The guard is the function's first statement, so this is about the
    // domain string and not about the Terraform input. It says which domains
    // reach the Kubernetes-specific derivation: one of three.
    expect(await refused("terraform")).toBe(refusal);
    expect(await refused("network")).toBe(refusal);
    expect(await refused("bogus")).toBe(refusal);
  });

  it("every grant the server signs is derived through that function: one signing call site, preceded by the binding", () => {
    const decisions = readFileSync(path.resolve("packages/server/src/decisions.ts"), "utf8");
    const sites = [...decisions.matchAll(/signGrant\(/g)];
    expect(sites).toHaveLength(1);
    const at = sites[0]?.index ?? -1;
    expect(decisions.slice(Math.max(0, at - 1200), at)).toContain("deriveReviewedGrantBinding(request)");
    // No other source file in the server package signs one.
    for (const name of readdirSync(path.resolve("packages/server/src"))) {
      if (name === "decisions.ts" || !name.endsWith(".ts")) continue;
      expect([name, readFileSync(path.resolve("packages/server/src", name), "utf8").includes("signGrant(")]).toEqual([name, false]);
    }
  });
});
