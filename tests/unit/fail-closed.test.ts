import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DomainError,
  evaluatePolicies,
  hasBlockingFinding,
  type DomainAdapter,
  type ChangeProposal,
} from "@changesafe/core";
import {
  IncidentBundleSchema,
  applyOperations,
  networkDomain,
} from "@changesafe/domain-network";
import { matchesAddress } from "@changesafe/domain-terraform";

/**
 * Failure modes that must not become silence: a policy that throws, and an
 * identifier that exists on `Object.prototype` rather than in the state.
 */

const bundle = IncidentBundleSchema.parse(
  JSON.parse(readFileSync("scenarios/network/scenario-a-failover/incident.json", "utf8")),
);
const fixture = JSON.parse(
  readFileSync("scenarios/network/scenario-a-failover/replay-fixture.json", "utf8"),
) as { proposal: ChangeProposal };

function proposalWithOperations(operations: ChangeProposal["operations"]): ChangeProposal {
  const [template] = fixture.proposal.operations;
  if (!template) throw new Error("fixture has no operation to model");
  return { ...fixture.proposal, operations };
}

describe("inherited property names are not state", () => {
  // `__proto__` is excluded by the kebab-case path pattern; `constructor` is
  // not, and a plain lookup would answer with Object's constructor.
  const inherited = ["constructor", "tostring"];

  it.each(inherited)("treats /devices/%s as a missing device, not a crash", (deviceId) => {
    let caught: unknown;
    try {
      applyOperations(bundle.currentState, [
        { op: "remove", path: `/devices/${deviceId}/routes/rt-x`, value: null, reason: "x", evidenceIds: [] },
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("PATCH_TARGET_MISSING");
  });

  it("gates a proposal targeting an inherited name without throwing", () => {
    const proposal = proposalWithOperations([
      {
        op: "remove",
        path: "/devices/constructor/routes/rt-x",
        value: null,
        reason: "removes a route that does not exist on a device that does not exist",
        evidenceIds: fixture.proposal.operations[0]?.evidenceIds ?? [],
      },
    ]);

    const { findings, riskLevel } = evaluatePolicies(networkDomain, bundle, proposal);

    // The gate reaches a verdict, and that verdict refuses the change.
    expect(hasBlockingFinding(findings)).toBe(true);
    expect(riskLevel).toBe("CRITICAL");
    expect(findings.find((finding) => finding.policyId === "PATCH_SCHEMA")?.status).toBe("BLOCK");
    // Every declared policy still produced a finding — none aborted the run.
    expect(findings.map((finding) => finding.policyId)).toContain("PROTECTED_RESOURCE");
  });
});

describe("a policy that throws fails closed", () => {
  it("records BLOCK under the policy's own id instead of abandoning the gate", () => {
    const exploding: DomainAdapter<typeof bundle, unknown> = {
      ...networkDomain,
      policies: [
        {
          id: "MGMT_REACHABILITY",
          evaluate: () => {
            throw new TypeError("Cannot read properties of undefined (reading 'routes')");
          },
        },
      ],
    };

    const { findings, riskLevel } = evaluatePolicies(exploding, bundle, fixture.proposal);

    const finding = findings.find((candidate) => candidate.policyId === "MGMT_REACHABILITY");
    expect(finding?.status).toBe("BLOCK");
    expect(finding?.title).toBe("Policy could not be evaluated");
    // The raw JS message stays out of what a user is shown.
    expect(finding?.explanation).not.toContain("Cannot read properties");
    expect(riskLevel).toBe("CRITICAL");
    // The rest of the gate still ran.
    expect(findings.map((candidate) => candidate.policyId)).toContain("BLAST_RADIUS");
  });
});

describe("terraform address globs", () => {
  it("matches the way a glob is expected to", () => {
    expect(matchesAddress("aws_s3_bucket.compliance", "aws_s3_bucket.*")).toBe(true);
    expect(matchesAddress("aws_s3_bucket.compliance", "*compliance")).toBe(true);
    expect(matchesAddress("aws_s3_bucket.compliance", "*.*")).toBe(true);
    expect(matchesAddress("aws_s3_bucket.compliance", "aws_db.*")).toBe(false);
    expect(matchesAddress("module.a.aws_s3_bucket.x", "module.*.aws_s3_bucket.*")).toBe(true);
    // A star is not a path separator escape hatch in either direction.
    expect(matchesAddress("exact", "exact")).toBe(true);
    expect(matchesAddress("exact", "exac")).toBe(false);
    expect(matchesAddress("", "*")).toBe(true);
  });

  it("answers promptly for a pattern that would make a regex backtrack", () => {
    // Compiled to `^.*a.*a…b$`, this pattern against a non-matching address
    // runs effectively forever.
    const pattern = `${"*a".repeat(12)}b`;
    const address = "a".repeat(400);

    const startedAt = process.hrtime.bigint();
    expect(matchesAddress(address, pattern)).toBe(false);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    expect(elapsedMs).toBeLessThan(100);
  });
});
