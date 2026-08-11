import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DomainError,
  evaluatePolicies,
  policyOrder,
  validateProposalEvidence,
  type PolicyFinding,
} from "@changesafe/core";

import { createTerraformDomain, terraformDomain } from "../src/adapter";
import { deriveProposal, normalizePlan } from "../src/normalize";
import { INJECTED_PULL_REQUEST_BODY } from "../../../features/domains/terraform/injected-pr-body";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

function loadPlan(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.tfplan.json`), "utf8"));
}

function gate(
  name: string,
  options: { context?: { kind: string; text: string }[]; pack?: Parameters<typeof createTerraformDomain>[0] } = {},
) {
  const domain = options.pack ? createTerraformDomain(options.pack) : terraformDomain;
  const input = normalizePlan(loadPlan(name), { context: options.context });
  const proposal = deriveProposal(input);
  validateProposalEvidence(domain, input, proposal);
  return { ...evaluatePolicies(domain, input, proposal), input, proposal, domain };
}

function statusOf(findings: PolicyFinding[], policyId: string): string | undefined {
  return findings.find((finding) => finding.policyId === policyId)?.status;
}

describe("plan normalization", () => {
  it("keeps only changes that actually change something", () => {
    const input = normalizePlan(loadPlan("safe-scale-up"));
    // The fixture includes a no-op; counting it would inflate blast radius.
    expect(input.changes).toHaveLength(3);
    expect(input.changes.map((change) => change.action).sort()).toEqual([
      "create",
      "update",
      "update",
    ]);
    expect(input.terraformVersion).toBe("1.9.5");
  });

  it("reads a two-element action array as a replace", () => {
    const input = normalizePlan(loadPlan("protected-and-injected"));
    const bucket = input.changes.find((change) => change.resourceType === "aws_s3_bucket");
    expect(bucket?.action).toBe("replace");
  });

  it("derives evidence from the plan's own entries", () => {
    const input = normalizePlan(loadPlan("destroys-database"));
    expect(input.changes.map((change) => change.evidenceId)).toEqual(["ev-plan-0", "ev-plan-1"]);
    const proposal = deriveProposal(input);
    // Every operation cites the plan entry that justifies it.
    expect(proposal.operations.every((operation) => operation.evidenceIds.length === 1)).toBe(true);
    expect(() => validateProposalEvidence(terraformDomain, input, proposal)).not.toThrow();
  });

  it("collects tags from the resource's prior state", () => {
    const input = normalizePlan(loadPlan("protected-and-injected"));
    const bucket = input.changes.find((change) => change.resourceType === "aws_s3_bucket");
    expect(bucket?.tags.changesafe_protected).toBe("true");
  });

  it("falls back to after-state tags only when there is no prior resource", () => {
    const input = normalizePlan({
      resource_changes: [
        {
          address: "aws_instance.new",
          type: "aws_instance",
          change: { actions: ["create"], before: null, after: { tags: { owner: "sre" } } },
        },
      ],
    });
    expect(input.changes[0]?.tags.owner).toBe("sre");
  });

  it("never lets a replacement's tags override the destroyed resource's own tags", () => {
    // A "replace" merges one plan entry's before (destroyed) and after
    // (replacement) state. An attacker who controls the plan can freely set
    // tags on `after` — the resource that is about to exist — but must not
    // be able to use them to fake a backup or clear protection on the
    // resource that is actually being destroyed.
    const forgedBackup = normalizePlan({
      resource_changes: [
        {
          address: "aws_db_instance.primary",
          type: "aws_db_instance",
          change: {
            actions: ["delete", "create"],
            before: { tags: {} },
            after: { tags: { changesafe_backup: "true" } },
          },
        },
      ],
    });
    expect(forgedBackup.changes[0]?.tags.changesafe_backup).toBeUndefined();

    const clearedProtection = normalizePlan({
      resource_changes: [
        {
          address: "aws_db_instance.primary",
          type: "aws_db_instance",
          change: {
            actions: ["delete", "create"],
            before: { tags: { changesafe_protected: "true" } },
            after: { tags: { changesafe_protected: "false" } },
          },
        },
      ],
    });
    expect(clearedProtection.changes[0]?.tags.changesafe_protected).toBe("true");
  });

  it("maps plan actions onto the gate's operation kinds", () => {
    const proposal = deriveProposal(normalizePlan(loadPlan("destroys-database")));
    const ops = new Map(proposal.operations.map((operation) => [operation.path, operation.op]));
    expect(ops.get("/resources/module-data-aws-db-instance-primary")).toBe("remove");
    expect(ops.get("/resources/module-data-aws-db-instance-replacement")).toBe("add");
  });

  it("rejects a file that is not plan JSON", () => {
    expect(() => normalizePlan({ hello: "world", resource_changes: "nope" })).toThrow(DomainError);
    expect(() => normalizePlan("not even an object")).toThrow(/terraform show -json/);
  });

  it("rejects a plan entry with an unexpected Terraform action", () => {
    expect(() =>
      normalizePlan({
        resource_changes: [
          {
            address: "aws_instance.web",
            type: "aws_instance",
            change: { actions: ["deposed"], before: null, after: null },
          },
        ],
      }),
    ).toThrow(/terraform show -json/);
  });

  it("refuses to gate a plan with nothing to do", () => {
    expect(() => deriveProposal(normalizePlan({ resource_changes: [] }))).toThrow(
      /nothing to gate/,
    );
  });

  it("tolerates unknown fields Terraform adds across versions", () => {
    const plan = loadPlan("safe-scale-up") as Record<string, unknown>;
    plan.checks = [{ some: "future field" }];
    (plan.resource_changes as Record<string, unknown>[])[0]!.importing = { id: "abc" };
    expect(() => normalizePlan(plan)).not.toThrow();
  });
});

describe("the terraform gate", () => {
  it("runs a domain-appropriate policy set", () => {
    // ROLLBACK_COMPLETE and VERIFICATION_REQUIRED do not apply to a plan;
    // the domain replaces the first and documents both.
    expect(policyOrder(terraformDomain)).toEqual([
      "PATCH_SCHEMA",
      "DESTRUCTIVE_OP",
      "PROTECTED_RESOURCE",
      "REVERSIBILITY",
      "PLAN_CONTEXT_REQUIRED",
      "BLAST_RADIUS",
      "UNTRUSTED_INSTRUCTION",
    ]);
    for (const skip of terraformDomain.skippedUniversalPolicies ?? []) {
      expect(skip.because.length).toBeGreaterThan(20);
      const replacedBy = skip.replacedBy;
      expect(replacedBy.kind).toBe("domain-policy");
      if (replacedBy.kind === "domain-policy") {
        expect(
          terraformDomain.policies.some((policy) => policy.id === replacedBy.policyId),
        ).toBe(true);
      }
    }
  });

  it("passes an ordinary scale-up", () => {
    const { findings, riskLevel } = gate("safe-scale-up");
    expect(findings.every((finding) => finding.status === "PASS")).toBe(true);
    expect(riskLevel).toBe("LOW");
  });

  it("blocks a plan that destroys a database", () => {
    const { findings, riskLevel } = gate("destroys-database");
    expect(statusOf(findings, "DESTRUCTIVE_OP")).toBe("BLOCK");
    expect(statusOf(findings, "REVERSIBILITY")).toBe("WARN");
    expect(statusOf(findings, "PLAN_CONTEXT_REQUIRED")).toBe("WARN");
    expect(riskLevel).toBe("CRITICAL");
    const destructive = findings.find((finding) => finding.policyId === "DESTRUCTIVE_OP");
    expect(destructive?.affectedResources).toEqual([
      "resource:module.data.aws_db_instance.primary",
    ]);
  });

  it("accepts a declared backup as a documented exception, still visibly", () => {
    const plan = loadPlan("destroys-database") as {
      resource_changes: { change: { before: Record<string, unknown> } }[];
    };
    (plan.resource_changes[0]!.change.before.tags as Record<string, string>).changesafe_backup =
      "true";
    const input = normalizePlan(plan, {
      context: [{ kind: "pull_request_description", text: "Decommission the backed-up replica." }],
    });
    const proposal = deriveProposal(input);
    const { findings, riskLevel } = evaluatePolicies(terraformDomain, input, proposal);
    // Downgraded, never silenced: the exception is in the receipt.
    expect(statusOf(findings, "DESTRUCTIVE_OP")).toBe("WARN");
    expect(statusOf(findings, "REVERSIBILITY")).toBe("PASS");
    expect(statusOf(findings, "PLAN_CONTEXT_REQUIRED")).toBe("PASS");
    expect(riskLevel).toBe("MEDIUM");
  });

  it("blocks destroying a protected resource and flags the injected PR text", () => {
    const context = [
      {
        kind: "pull request body",
        text: INJECTED_PULL_REQUEST_BODY,
      },
    ];
    const { findings, riskLevel } = gate("protected-and-injected", { context });

    expect(statusOf(findings, "PROTECTED_RESOURCE")).toBe("BLOCK");
    expect(statusOf(findings, "DESTRUCTIVE_OP")).toBe("BLOCK");
    expect(statusOf(findings, "UNTRUSTED_INSTRUCTION")).toBe("WARN");
    expect(riskLevel).toBe("CRITICAL");

    const injection = findings.find((finding) => finding.policyId === "UNTRUSTED_INSTRUCTION");
    expect(injection?.affectedResources).toEqual(["evidence:ev-context-0"]);
    // The injection asked for approval; the gate blocked anyway, because the
    // block comes from the plan's contents, not from reading the text.
    expect(injection?.status).not.toBe("BLOCK");
  });

  it("cannot be talked out of blocking by tags planted on the replacement resource", () => {
    // Same shape as the protected-and-injected fixture (a "replace"), but the
    // protected tag now lives only on `before` and the replacement tries to
    // clear it — the exact forgery a plan author fully controls.
    const input = normalizePlan({
      resource_changes: [
        {
          address: "module.audit.aws_s3_bucket.compliance_logs",
          type: "aws_s3_bucket",
          change: {
            actions: ["delete", "create"],
            before: { tags: { changesafe_protected: "true" } },
            after: { tags: { changesafe_protected: "false", changesafe_backup: "true" } },
          },
        },
      ],
    });
    const proposal = deriveProposal(input);
    const { findings, riskLevel } = evaluatePolicies(terraformDomain, input, proposal);

    expect(statusOf(findings, "PROTECTED_RESOURCE")).toBe("BLOCK");
    expect(statusOf(findings, "DESTRUCTIVE_OP")).toBe("BLOCK");
    expect(riskLevel).toBe("CRITICAL");
  });

  it("blocks a destroy whose prior state was never recorded", () => {
    const input = normalizePlan({
      resource_changes: [
        {
          address: "aws_instance.orphan",
          type: "aws_instance",
          change: { actions: ["delete"], before: null, after: null },
        },
      ],
    });
    const proposal = deriveProposal(input);
    const { findings } = evaluatePolicies(terraformDomain, input, proposal);
    expect(statusOf(findings, "REVERSIBILITY")).toBe("BLOCK");
    expect(statusOf(findings, "PLAN_CONTEXT_REQUIRED")).toBe("WARN");
  });

  describe("PLAN_CONTEXT_REQUIRED", () => {
    it("passes a plan that destroys nothing, regardless of context", () => {
      const { findings } = gate("safe-scale-up");
      expect(statusOf(findings, "PLAN_CONTEXT_REQUIRED")).toBe("PASS");
    });

    it("warns when a destructive plan carries no PR or commit context", () => {
      const { findings } = gate("destroys-database");
      const finding = findings.find((f) => f.policyId === "PLAN_CONTEXT_REQUIRED");
      expect(finding?.status).toBe("WARN");
      expect(finding?.affectedResources).toEqual(["resource:module.data.aws_db_instance.primary"]);
    });

    it("passes once the plan carries any context entry", () => {
      const { findings } = gate("destroys-database", {
        context: [{ kind: "commit_message", text: "Retire the legacy read replica." }],
      });
      expect(statusOf(findings, "PLAN_CONTEXT_REQUIRED")).toBe("PASS");
    });
  });

  it("uses thresholds suited to cloud plans, not to routers", () => {
    // Three changed resources would breach the network domain's default of
    // two; for a plan it is unremarkable.
    const { findings } = gate("safe-scale-up");
    expect(statusOf(findings, "BLAST_RADIUS")).toBe("PASS");
    expect(terraformDomain.defaultPolicyPack?.blastRadius?.warnAt).toBe(15);
  });

  it("lets a pack protect addresses by pattern", () => {
    const { findings } = gate("safe-scale-up", {
      pack: { protectedAddressPatterns: ["module.web.aws_autoscaling_group.*"] },
    });
    // The pattern matches, but the plan only updates it — protection is about
    // destruction, not change.
    expect(statusOf(findings, "PROTECTED_RESOURCE")).toBe("PASS");

    const destroyed = gate("destroys-database", {
      pack: { protectedAddressPatterns: ["module.data.*"] },
    });
    expect(statusOf(destroyed.findings, "PROTECTED_RESOURCE")).toBe("BLOCK");
  });

  it("lets a pack decide what counts as stateful", () => {
    const { findings } = gate("safe-scale-up", {
      pack: { statefulResourcePatterns: ["autoscaling"] },
    });
    // Nothing is destroyed here, so widening statefulness changes nothing.
    expect(statusOf(findings, "DESTRUCTIVE_OP")).toBe("PASS");

    const narrowed = gate("destroys-database", { pack: { statefulResourcePatterns: ["_nothing_"] } });
    // With databases no longer classed as stateful, destruction warns.
    expect(statusOf(narrowed.findings, "DESTRUCTIVE_OP")).toBe("WARN");
  });

  it("blocks an operation that misrepresents what the plan does", () => {
    const input = normalizePlan(loadPlan("destroys-database"));
    const proposal = deriveProposal(input);
    // Claim the database delete is a harmless update.
    const tampered = {
      ...proposal,
      operations: proposal.operations.map((operation) =>
        operation.path === "/resources/module-data-aws-db-instance-primary"
          ? { ...operation, op: "replace" as const }
          : operation,
      ),
    };
    const { findings } = evaluatePolicies(terraformDomain, input, tampered);
    expect(statusOf(findings, "PATCH_SCHEMA")).toBe("BLOCK");
  });
});
