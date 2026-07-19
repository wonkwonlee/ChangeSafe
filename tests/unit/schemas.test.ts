import { describe, expect, it } from "vitest";

import {
  ChangeProposalSchema,
  ChangeReceiptSchema,
  IncidentBundleSchema,
  ReplayFixtureSchema,
  StatePathSchema,
} from "@/lib/domain/schemas";
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
      provenance: "captured_gpt_5_6",
      model: null,
      capturedAtUtc: null,
    };
    expect(ReplayFixtureSchema.safeParse(fixture).success).toBe(false);
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
