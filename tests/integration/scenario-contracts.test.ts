import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DomainError, IllegalTransitionError , policyOrder } from "@changesafe/core";

import { initialState, transition, type WorkflowState } from "@changesafe/core";
import { validateProposalEvidence } from "@changesafe/core";
import { runSimulation , networkDomain , POLICY_VERSION } from "@changesafe/domain-network";
import { evaluatePolicies } from "@changesafe/core";
import { createReceipt, verifyReceiptHash } from "@changesafe/core";
import { SCENARIOS, getScenario, type ScenarioDefinition } from "@/scenarios";

/**
 * The scenario harness. Every bundled scenario declares its expected gate
 * outcome in `expectations.json`; this file proves the engine agrees, for
 * every scenario, without per-scenario test code. Adding a scenario is
 * therefore a content change whose claims CI verifies.
 */

const SCENARIOS_DIR = path.join(process.cwd(), "scenarios");

function scenarioDirectoriesOnDisk(): string[] {
  return readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("scenario registry completeness", () => {
  it("registers every scenario directory found on disk", () => {
    const registered = SCENARIOS.map((scenario) => scenario.scenarioId).sort();
    expect(scenarioDirectoriesOnDisk()).toEqual(registered);
  });

  it("ships the three required files for every registered scenario", () => {
    for (const scenario of SCENARIOS) {
      for (const file of ["incident.json", "replay-fixture.json", "expectations.json"]) {
        const filePath = path.join(SCENARIOS_DIR, scenario.scenarioId, file);
        expect(existsSync(filePath), `${scenario.scenarioId}/${file}`).toBe(true);
      }
    }
  });

  it("gives every scenario a unique id and an incident-styled label", () => {
    const ids = SCENARIOS.map((scenario) => scenario.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of SCENARIOS) {
      // Labels describe the situation; they must not leak the verdict.
      expect(scenario.label.toLowerCase()).not.toMatch(/\b(safe|unsafe|blocked|pass|fail)\b/);
      expect(scenario.expectations.teaches.length).toBeGreaterThan(20);
    }
  });
});

describe("scenario integrity (all scenarios)", () => {
  it.each(SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s cites only evidence that exists in its bundle",
    (_id, scenario) => {
      expect(() =>
        validateProposalEvidence(networkDomain, scenario.bundle, scenario.fixture.proposal),
      ).not.toThrow();
    },
  );

  it.each(SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s declares honest fixture provenance",
    (_id, scenario) => {
      const { provenance, model, capturedAtUtc } = scenario.fixture;
      if (provenance === "captured") {
        expect(model).not.toBeNull();
        expect(capturedAtUtc).not.toBeNull();
      } else {
        // Authored content is never attributed to a model.
        expect(model).toBeNull();
      }
    },
  );

  it.each(SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s uses documentation address ranges only",
    (_id, scenario) => {
      const serialized = JSON.stringify(scenario.bundle);
      const ipv4 = serialized.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];
      const documentationRange = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|0\.0\.0\.0$)/;
      for (const address of ipv4) {
        expect(address, `${address} is outside the documentation ranges`).toMatch(
          documentationRange,
        );
      }
    },
  );

  it("rejects invented evidence ids", () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error("no scenarios registered");
    const proposal = structuredClone(scenario.fixture.proposal);
    proposal.diagnosis.evidenceIds.push("ev-ghost-claim");
    try {
      validateProposalEvidence(networkDomain, scenario.bundle, proposal);
      expect.fail("expected EVIDENCE_UNKNOWN");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("EVIDENCE_UNKNOWN");
    }
  });
});

describe("declared expectations hold (all scenarios)", () => {
  it.each(SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s produces exactly its declared policy verdicts and risk",
    (_id, scenario) => {
      const { findings, riskLevel } = evaluatePolicies(networkDomain, scenario.bundle, scenario.fixture.proposal);

      expect(findings.map((finding) => finding.policyId)).toEqual(policyOrder(networkDomain));

      // Policy ids are open across domains, so exhaustiveness is proven here
      // rather than in the schema: a scenario must declare a verdict for every
      // policy this domain evaluates, and no others.
      expect(Object.keys(scenario.expectations.policies).sort()).toEqual(
        [...policyOrder(networkDomain)].sort(),
      );

      for (const finding of findings) {
        expect(
          finding.status,
          `${scenario.scenarioId}: ${finding.policyId} — ${finding.explanation}`,
        ).toBe(scenario.expectations.policies[finding.policyId]);
      }

      expect(riskLevel).toBe(scenario.expectations.riskLevel);
    },
  );

  it.each(SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s matches its declared affected resources",
    (_id, scenario) => {
      const declared = scenario.expectations.affectedResources;
      if (!declared) return;
      const { findings } = evaluatePolicies(networkDomain, scenario.bundle, scenario.fixture.proposal);

      for (const [policyId, resources] of Object.entries(declared)) {
        const finding = findings.find((candidate) => candidate.policyId === policyId);
        expect(finding, `${policyId} finding missing`).toBeDefined();
        expect([...(finding?.affectedResources ?? [])].sort()).toEqual([...resources].sort());
      }
    },
  );
});

/** Walk a scenario to the point where the human decision is required. */
function advanceToDecision(scenario: ScenarioDefinition): WorkflowState {
  const { findings, riskLevel } = evaluatePolicies(networkDomain, scenario.bundle, scenario.fixture.proposal);
  let state: WorkflowState = initialState(scenario.scenarioId, scenario.bundle);
  state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
  state = transition(state, {
    type: "PROPOSAL_RECEIVED",
    proposal: scenario.fixture.proposal,
    mode: "replay",
    provenance: scenario.fixture.provenance,
  });
  state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
  return transition(state, { type: "CLASSIFY" });
}

const approvableScenarios = SCENARIOS.filter((s) => s.expectations.approvable);
const blockedScenarios = SCENARIOS.filter((s) => !s.expectations.approvable);

describe.runIf(approvableScenarios.length > 0)("approvable scenarios", () => {
  it.each(approvableScenarios.map((s) => [s.scenarioId, s] as const))(
    "%s runs approve → simulate → verified receipt",
    async (_id, scenario) => {
      let state = advanceToDecision(scenario);
      expect(state.phase).toBe("APPROVAL_REQUIRED");

      state = transition(state, { type: "APPROVE" });
      const simulation = runSimulation(scenario.bundle, scenario.fixture.proposal);
      expect(simulation.safetyProperties.every((property) => property.satisfied)).toBe(
        scenario.expectations.simulation?.safetyPropertiesSatisfied,
      );
      state = transition(state, { type: "SIMULATION_COMPLETED", simulation });

      if (state.phase !== "SIMULATED") throw new Error("expected SIMULATED");
      const receipt = await createReceipt({
        sourceId: scenario.scenarioId,
        inputId: scenario.bundle.incidentId,
        input: scenario.bundle,
        appVersion: "test",
        policyVersion: POLICY_VERSION,
        proposal: scenario.fixture.proposal,
        mode: "replay",
        model: scenario.fixture.model,
        fixtureProvenance: scenario.fixture.provenance,
        findings: state.findings,
        riskLevel: state.riskLevel,
        decision: "approved",
        simulation,
      });
      state = transition(state, { type: "RECEIPT_CREATED", receipt });

      expect(state.phase).toBe("RECEIPT_ISSUED");
      expect(receipt.riskLevel).toBe(scenario.expectations.riskLevel);
      expect(await verifyReceiptHash(receipt)).toBe(true);
    },
  );

  it.each(approvableScenarios.map((s) => [s.scenarioId, s] as const))(
    "%s can also be rejected by the human",
    (_id, scenario) => {
      const state = transition(advanceToDecision(scenario), { type: "REJECT" });
      expect(state.phase).toBe("REJECTED");
    },
  );
});

describe.runIf(blockedScenarios.length > 0)("blocked scenarios", () => {
  it.each(blockedScenarios.map((s) => [s.scenarioId, s] as const))(
    "%s classifies to BLOCKED and can never be approved or simulated",
    (_id, scenario) => {
      const state = advanceToDecision(scenario);
      expect(state.phase).toBe("BLOCKED");

      expect(() => transition(state, { type: "APPROVE" })).toThrow(IllegalTransitionError);

      // Even a well-formed simulation payload cannot be injected into a
      // blocked workflow.
      const donor = approvableScenarios[0];
      if (donor) {
        const simulation = runSimulation(donor.bundle, donor.fixture.proposal);
        expect(() =>
          transition(state, { type: "SIMULATION_COMPLETED", simulation }),
        ).toThrow(IllegalTransitionError);
      }
    },
  );

  it.each(blockedScenarios.map((s) => [s.scenarioId, s] as const))(
    "%s issues a blocked receipt with no simulation and rejects an approved one",
    async (_id, scenario) => {
      const state = advanceToDecision(scenario);
      if (state.phase !== "BLOCKED") throw new Error("expected BLOCKED");

      const receipt = await createReceipt({
        sourceId: scenario.scenarioId,
        inputId: scenario.bundle.incidentId,
        input: scenario.bundle,
        appVersion: "test",
        policyVersion: POLICY_VERSION,
        proposal: scenario.fixture.proposal,
        mode: "replay",
        model: scenario.fixture.model,
        fixtureProvenance: scenario.fixture.provenance,
        findings: state.findings,
        riskLevel: state.riskLevel,
        decision: "blocked",
        simulation: null,
      });
      expect(receipt.decision).toBe("blocked");
      expect(receipt.simulation).toBeNull();
      expect(await verifyReceiptHash(receipt)).toBe(true);

      await expect(
        createReceipt({
          sourceId: scenario.scenarioId,
          inputId: scenario.bundle.incidentId,
          input: scenario.bundle,
          appVersion: "test",
          policyVersion: POLICY_VERSION,
          proposal: scenario.fixture.proposal,
          mode: "replay",
          model: scenario.fixture.model,
          fixtureProvenance: scenario.fixture.provenance,
          findings: state.findings,
          riskLevel: state.riskLevel,
          decision: "approved",
          simulation: null,
        }),
      ).rejects.toThrow();
    },
  );
});

describe("flagship scenarios remain present", () => {
  // The demo and docs reference these by id; renaming them is a breaking
  // change that should fail loudly rather than silently break the README.
  it.each(["scenario-a-failover", "scenario-b-route-leak"])("%s is registered", (scenarioId) => {
    expect(getScenario(scenarioId)).toBeDefined();
  });

  it("keeps a red-team scenario that always blocks", () => {
    const redTeam = SCENARIOS.filter((s) => s.fixture.provenance === "authored_red_team");
    expect(redTeam.length).toBeGreaterThan(0);
    for (const scenario of redTeam) {
      expect(scenario.expectations.approvable).toBe(false);
    }
  });
});
