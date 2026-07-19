import { describe, expect, it } from "vitest";

import { DomainError, IllegalTransitionError } from "@/lib/domain/errors";
import { initialState, transition, type WorkflowState } from "@/lib/domain/state-machine";
import { validateProposalEvidence } from "@/lib/domain/validate";
import { runSimulation } from "@/lib/patch/simulate";
import { evaluatePolicies } from "@/lib/policies";
import { createReceipt, verifyReceiptHash } from "@/lib/receipt/receipt";
import { SCENARIOS, getScenario } from "@/scenarios";

const scenarioA = getScenario("scenario-a-failover");
const scenarioB = getScenario("scenario-b-route-leak");

if (!scenarioA || !scenarioB) throw new Error("bundled scenarios failed to load");

describe("bundled scenario integrity", () => {
  it("ships exactly two scenarios that pass production schemas at load", () => {
    expect(SCENARIOS).toHaveLength(2);
  });

  it("cites only evidence that exists in each bundle", () => {
    for (const scenario of SCENARIOS) {
      expect(() =>
        validateProposalEvidence(scenario.bundle, scenario.fixture.proposal),
      ).not.toThrow();
    }
  });

  it("rejects invented evidence ids", () => {
    const proposal = structuredClone(scenarioA.fixture.proposal);
    proposal.diagnosis.evidenceIds.push("ev-ghost-claim");
    try {
      validateProposalEvidence(scenarioA.bundle, proposal);
      expect.fail("expected EVIDENCE_UNKNOWN");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("EVIDENCE_UNKNOWN");
      expect((error as DomainError).userMessage).toContain("ev-ghost-claim");
    }
  });

  it("labels fixture provenance honestly and claims no model for authored fixtures", () => {
    expect(scenarioA.fixture.provenance).toBe("authored_synthetic");
    expect(scenarioB.fixture.provenance).toBe("authored_red_team");
    expect(scenarioA.fixture.model).toBeNull();
    expect(scenarioB.fixture.model).toBeNull();
  });
});

describe("scenario A (safe failover) contract", () => {
  it("produces zero BLOCK findings and LOW risk", () => {
    const { findings, riskLevel } = evaluatePolicies(scenarioA.bundle, scenarioA.fixture.proposal);
    expect(findings.filter((finding) => finding.status === "BLOCK")).toHaveLength(0);
    expect(findings.every((finding) => finding.status === "PASS")).toBe(true);
    expect(riskLevel).toBe("LOW");
  });

  it("is approvable, simulatable, and receipt-issuable end to end", async () => {
    const { findings, riskLevel } = evaluatePolicies(scenarioA.bundle, scenarioA.fixture.proposal);

    let state: WorkflowState = initialState(scenarioA.scenarioId, scenarioA.bundle);
    state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
    state = transition(state, {
      type: "PROPOSAL_RECEIVED",
      proposal: scenarioA.fixture.proposal,
      mode: "replay",
      provenance: scenarioA.fixture.provenance,
    });
    state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
    state = transition(state, { type: "CLASSIFY" });
    expect(state.phase).toBe("APPROVAL_REQUIRED");

    state = transition(state, { type: "APPROVE" });
    const simulation = runSimulation(scenarioA.bundle, scenarioA.fixture.proposal);
    expect(simulation.safetyProperties.every((property) => property.satisfied)).toBe(true);
    state = transition(state, { type: "SIMULATION_COMPLETED", simulation });

    const receipt = await createReceipt({
      scenarioId: scenarioA.scenarioId,
      bundle: scenarioA.bundle,
      proposal: scenarioA.fixture.proposal,
      mode: "replay",
      model: null,
      fixtureProvenance: scenarioA.fixture.provenance,
      findings,
      riskLevel,
      decision: "approved",
      simulation,
    });
    state = transition(state, { type: "RECEIPT_CREATED", receipt });

    expect(state.phase).toBe("RECEIPT_ISSUED");
    expect(await verifyReceiptHash(receipt)).toBe(true);
  });

  it("keeps the primary route in the table after the simulated change", () => {
    const simulation = runSimulation(scenarioA.bundle, scenarioA.fixture.proposal);
    const retained = simulation.safetyProperties.find(
      (property) => property.propertyId === "sp-a-primary-retained",
    );
    expect(retained?.satisfied).toBe(true);
  });
});

describe("scenario B (unsafe route removal) contract", () => {
  const evaluation = () => evaluatePolicies(scenarioB.bundle, scenarioB.fixture.proposal);

  it("always produces the required BLOCK and WARN findings", () => {
    const { findings, riskLevel } = evaluation();
    const byId = new Map(findings.map((finding) => [finding.policyId, finding]));

    expect(byId.get("MGMT_REACHABILITY")?.status).toBe("BLOCK");
    expect(byId.get("PROTECTED_RESOURCE")?.status).toBe("BLOCK");
    expect(byId.get("UNTRUSTED_INSTRUCTION")?.status).toBe("WARN");
    expect(byId.get("UNTRUSTED_INSTRUCTION")?.affectedResources).toContain(
      "evidence:ev-note-inject",
    );
    expect(riskLevel).toBe("CRITICAL");
  });

  it("blocks specifically because the firewall becomes unreachable", () => {
    const { findings } = evaluation();
    const reachability = findings.find((finding) => finding.policyId === "MGMT_REACHABILITY");
    expect(reachability?.affectedResources).toEqual(["node:dist-fw-01"]);
  });

  it("classifies to BLOCKED and can never be approved or simulated via the domain", () => {
    const { findings, riskLevel } = evaluation();

    let state: WorkflowState = initialState(scenarioB.scenarioId, scenarioB.bundle);
    state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
    state = transition(state, {
      type: "PROPOSAL_RECEIVED",
      proposal: scenarioB.fixture.proposal,
      mode: "replay",
      provenance: scenarioB.fixture.provenance,
    });
    state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
    state = transition(state, { type: "CLASSIFY" });
    expect(state.phase).toBe("BLOCKED");

    expect(() => transition(state, { type: "APPROVE" })).toThrow(IllegalTransitionError);
    // A well-formed simulation payload (built from the safe scenario) still
    // cannot be injected into a BLOCKED workflow.
    const simulation = runSimulation(scenarioA.bundle, scenarioA.fixture.proposal);
    expect(() =>
      transition(state, { type: "SIMULATION_COMPLETED", simulation }),
    ).toThrow(IllegalTransitionError);
  });

  it("issues a blocked receipt without any simulation", async () => {
    const { findings, riskLevel } = evaluation();
    const receipt = await createReceipt({
      scenarioId: scenarioB.scenarioId,
      bundle: scenarioB.bundle,
      proposal: scenarioB.fixture.proposal,
      mode: "replay",
      model: null,
      fixtureProvenance: scenarioB.fixture.provenance,
      findings,
      riskLevel,
      decision: "blocked",
      simulation: null,
    });
    expect(receipt.decision).toBe("blocked");
    expect(receipt.simulation).toBeNull();
    expect(await verifyReceiptHash(receipt)).toBe(true);
  });

  it("cannot sneak into an approved receipt", async () => {
    const { findings, riskLevel } = evaluation();
    await expect(
      createReceipt({
        scenarioId: scenarioB.scenarioId,
        bundle: scenarioB.bundle,
        proposal: scenarioB.fixture.proposal,
        mode: "replay",
        model: null,
        fixtureProvenance: scenarioB.fixture.provenance,
        findings,
        riskLevel,
        decision: "approved",
        simulation: null,
      }),
    ).rejects.toThrow();
  });
});
