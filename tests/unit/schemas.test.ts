import { describe, expect, it } from "vitest";

import { ChangeProposalSchema, ChangeReceiptSchema, ReplayFixtureSchema, ScenarioExpectationsSchema, StatePathSchema } from "@changesafe/core";
import { IncidentBundleSchema } from "@changesafe/domain-network";
import {
  buildIncidentBundle,
  buildOperation,
  buildProposal,
  buildReceipt,
  buildSimulation,
} from "@/tests/helpers/fixtures";

describe("IncidentBundleSchema", () => {
  it("accepts a well-formed synthetic bundle", () => {
    expect(IncidentBundleSchema.safeParse(buildIncidentBundle()).success).toBe(true);
  });

  it("rejects a device record whose key does not match device.id", () => {
    const bundle = buildIncidentBundle();
    const device = bundle.currentState.devices["edge-rtr-01"];
    if (!device) throw new Error("fixture invariant");
    bundle.currentState.devices["edge-rtr-99"] = device;
    delete bundle.currentState.devices["edge-rtr-01"];
    const result = IncidentBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("rejects topology links that reference unknown nodes", () => {
    const bundle = buildIncidentBundle();
    bundle.topology.links.push({
      id: "link-ghost",
      a: { nodeId: "ghost-node", interfaceId: "eth0" },
      b: { nodeId: "edge-rtr-01", interfaceId: "mgmt0" },
      status: "up",
    });
    expect(IncidentBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects duplicate evidence ids across alerts and notes", () => {
    const bundle = buildIncidentBundle();
    bundle.operatorNotes.push({
      evidenceId: "ev-alert-001",
      author: "second engineer",
      timestamp: "2026-07-18T09:20:00Z",
      content: "Duplicate id on purpose.",
    });
    expect(IncidentBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects a management origin that is not in the topology", () => {
    const bundle = buildIncidentBundle();
    bundle.currentState.management.originNodeId = "ghost-mgmt";
    expect(IncidentBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects unknown extra keys", () => {
    const bundle = { ...buildIncidentBundle(), surprise: true };
    expect(IncidentBundleSchema.safeParse(bundle).success).toBe(false);
  });
});

describe("ChangeProposalSchema", () => {
  it("accepts a well-formed proposal", () => {
    expect(ChangeProposalSchema.safeParse(buildProposal()).success).toBe(true);
  });

  it("rejects command-string style paths", () => {
    for (const path of [
      "/devices/edge-rtr-01; rm -rf /",
      "/devices/../etc/passwd",
      "conf t",
      "/devices/EDGE-RTR-01/routes",
      "/devices/edge rtr/routes",
    ]) {
      expect(StatePathSchema.safeParse(path).success, path).toBe(false);
    }
  });

  it("rejects confidence outside 0..1", () => {
    const proposal = buildProposal();
    proposal.diagnosis.confidence = 1.4;
    expect(ChangeProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it("rejects operations without evidence ids", () => {
    const proposal = buildProposal({
      operations: [buildOperation({ evidenceIds: [] })],
    });
    expect(ChangeProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it("rejects an empty operations list", () => {
    const proposal = { ...buildProposal(), operations: [] };
    expect(ChangeProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it("accepts empty rollback so ROLLBACK_COMPLETE can block it deterministically", () => {
    const proposal = { ...buildProposal(), rollbackOperations: [] };
    expect(ChangeProposalSchema.safeParse(proposal).success).toBe(true);
  });
});

describe("ReplayFixtureSchema provenance honesty", () => {
  const base = {
    fixtureId: "fix-test-001",
    scenarioId: "scenario-test",
    notes: "Synthetic fixture for tests.",
    proposal: buildProposal(),
  };

  it("accepts an authored fixture with no model claim", () => {
    const fixture = {
      ...base,
      provenance: "authored_synthetic",
      model: null,
      capturedAtUtc: null,
    };
    expect(ReplayFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it("rejects an authored fixture that claims a model", () => {
    const fixture = {
      ...base,
      provenance: "authored_red_team",
      model: "gpt-5.6",
      capturedAtUtc: null,
    };
    expect(ReplayFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects a captured fixture without capture metadata", () => {
    const fixture = {
      ...base,
      provenance: "captured",
      model: null,
      capturedAtUtc: null,
    };
    expect(ReplayFixtureSchema.safeParse(fixture).success).toBe(false);
  });
});

describe("ScenarioExpectationsSchema self-consistency", () => {
  const allPass = {
    PATCH_SCHEMA: "PASS",
    MGMT_REACHABILITY: "PASS",
    PROTECTED_RESOURCE: "PASS",
    BLAST_RADIUS: "PASS",
    ROLLBACK_COMPLETE: "PASS",
    VERIFICATION_REQUIRED: "PASS",
    UNTRUSTED_INSTRUCTION: "PASS",
  } as const;

  const base = {
    scenarioId: "scenario-test",
    teaches: "A synthetic expectations file used by the schema unit tests.",
    policies: allPass,
    riskLevel: "LOW",
    approvable: true,
    simulation: { safetyPropertiesSatisfied: true },
  };

  it("accepts a consistent all-PASS expectation", () => {
    expect(ScenarioExpectationsSchema.safeParse(base).success).toBe(true);
  });

  it("accepts any non-empty policy map, since domains contribute their own ids", () => {
    const partial = Object.fromEntries(
      Object.entries(allPass).filter(([policyId]) => policyId !== "PATCH_SCHEMA"),
    );
    expect(ScenarioExpectationsSchema.safeParse({ ...base, policies: partial }).success).toBe(
      true,
    );
    // Exhaustiveness is a per-domain property, proven by the scenario harness
    // asserting the declared ids equal the ids the gate actually produces.
  });

  it("rejects an empty policy map", () => {
    expect(ScenarioExpectationsSchema.safeParse({ ...base, policies: {} }).success).toBe(false);
  });

  it("rejects a risk level that contradicts the declared statuses", () => {
    expect(
      ScenarioExpectationsSchema.safeParse({ ...base, riskLevel: "HIGH" }).success,
    ).toBe(false);

    const oneWarn = { ...allPass, VERIFICATION_REQUIRED: "WARN" } as const;
    expect(
      ScenarioExpectationsSchema.safeParse({ ...base, policies: oneWarn, riskLevel: "LOW" })
        .success,
    ).toBe(false);
    expect(
      ScenarioExpectationsSchema.safeParse({ ...base, policies: oneWarn, riskLevel: "MEDIUM" })
        .success,
    ).toBe(true);
  });

  it("rejects claiming a blocked scenario is approvable", () => {
    const blocked = { ...allPass, MGMT_REACHABILITY: "BLOCK" } as const;
    expect(
      ScenarioExpectationsSchema.safeParse({
        ...base,
        policies: blocked,
        riskLevel: "CRITICAL",
        approvable: true,
        simulation: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a simulation outcome on a blocked scenario", () => {
    const blocked = { ...allPass, PROTECTED_RESOURCE: "BLOCK" } as const;
    expect(
      ScenarioExpectationsSchema.safeParse({
        ...base,
        policies: blocked,
        riskLevel: "CRITICAL",
        approvable: false,
        simulation: { safetyPropertiesSatisfied: true },
      }).success,
    ).toBe(false);
  });

  it("requires an approvable scenario to declare its simulation outcome", () => {
    expect(
      ScenarioExpectationsSchema.safeParse({ ...base, simulation: null }).success,
    ).toBe(false);
  });

  it("rejects malformed policy ids", () => {
    expect(
      ScenarioExpectationsSchema.safeParse({
        ...base,
        affectedResources: { "not-a-policy": ["device:x"] },
      }).success,
    ).toBe(false);
    expect(
      ScenarioExpectationsSchema.safeParse({
        ...base,
        policies: { ...allPass, "lower_case": "PASS" },
      }).success,
    ).toBe(false);
  });
});

describe("ChangeReceiptSchema invariants", () => {
  it("accepts a rejected replay receipt", () => {
    expect(ChangeReceiptSchema.safeParse(buildReceipt()).success).toBe(true);
  });

  it("rejects replay receipts without fixture provenance", () => {
    const receipt = buildReceipt({ fixtureProvenance: null });
    expect(ChangeReceiptSchema.safeParse(receipt).success).toBe(false);
  });

  it("rejects live receipts that carry fixture provenance", () => {
    const receipt = buildReceipt({ mode: "live", model: "gpt-5.6" });
    expect(ChangeReceiptSchema.safeParse(receipt).success).toBe(false);
  });

  it("rejects non-approved receipts that carry a simulation", () => {
    const receipt = buildReceipt({ decision: "blocked", simulation: buildSimulation() });
    expect(ChangeReceiptSchema.safeParse(receipt).success).toBe(false);
  });

  it("rejects approved receipts without a simulation", () => {
    const receipt = buildReceipt({ decision: "approved", simulation: null });
    expect(ChangeReceiptSchema.safeParse(receipt).success).toBe(false);
  });
});
