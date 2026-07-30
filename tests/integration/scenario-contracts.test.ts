import { mkdtempSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DomainError, IllegalTransitionError, policyOrder } from "@changesafe/core";

import { initialState, transition, type WorkflowState } from "@changesafe/core";
import { validateProposalEvidence } from "@changesafe/core";
import { evaluatePolicies } from "@changesafe/core";
import { createReceipt, verifyReceiptHash } from "@changesafe/core";
import { SCENARIOS, getScenario, type ScenarioDefinition } from "@/scenarios";
import { SCENARIO_DOMAIN_IDS, resolveScenarioDomain } from "@/scenarios/domains";

/**
 * The scenario harness. Every bundled scenario declares its expected gate
 * outcome in `expectations.json`; this file proves the engine agrees, for
 * every scenario in every domain, without per-scenario test code. Adding a
 * scenario is therefore a content change whose claims CI verifies.
 */

const SCENARIOS_DIR = path.join(process.cwd(), "scenarios");

function scenarioDirectoriesOnDisk(root = SCENARIOS_DIR): string[] {
  const ids: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!SCENARIO_DOMAIN_IDS.includes(entry.name)) {
      throw new Error(`scenario directory is outside a registered domain: ${entry.name}`);
    }
    for (const scenario of readdirSync(path.join(root, entry.name), { withFileTypes: true })) {
      if (scenario.isDirectory()) ids.push(scenario.name);
    }
  }
  return ids.sort();
}

describe("scenario registry completeness", () => {
  it("registers every scenario directory found on disk", () => {
    const registered = SCENARIOS.map((scenario) => scenario.scenarioId).sort();
    expect(scenarioDirectoriesOnDisk()).toEqual(registered);
  });

  it("rejects scenarios placed outside a registered domain", () => {
    const root = mkdtempSync(path.join(tmpdir(), "changesafe-scenarios-"));
    mkdirSync(path.join(root, "misspelled-domain", "scenario-one"), { recursive: true });
    try {
      expect(() => scenarioDirectoriesOnDisk(root)).toThrow(/outside a registered domain/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ships the required files for every registered scenario", () => {
    for (const scenario of SCENARIOS) {
      const dir = path.join(SCENARIOS_DIR, scenario.domainId, scenario.scenarioId);
      for (const file of ["incident.json", "expectations.json"]) {
        expect(existsSync(path.join(dir, file)), `${scenario.scenarioId}/${file}`).toBe(true);
      }
      // Only a domain that ships fixtures (network, kubernetes) has one;
      // an external-diff domain (terraform) derives its proposal instead.
      expect(existsSync(path.join(dir, "replay-fixture.json"))).toBe(scenario.fixture !== null);
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
    "%s cites only evidence that exists in its input",
    (_id, scenario) => {
      const { adapter } = resolveScenarioDomain(scenario.domainId);
      expect(() =>
        validateProposalEvidence(adapter, scenario.input as never, scenario.proposal),
      ).not.toThrow();
    },
  );

  it.each(
    SCENARIOS.filter((s) => s.fixture !== null).map((s) => [s.scenarioId, s] as const),
  )("%s declares honest fixture provenance", (_id, scenario) => {
    const { provenance, model, capturedAtUtc } = scenario.fixture!;
    if (provenance === "captured") {
      expect(model).not.toBeNull();
      expect(capturedAtUtc).not.toBeNull();
    } else {
      // Authored content is never attributed to a model.
      expect(model).toBeNull();
    }
  });

  it.each(SCENARIOS.map((s) => [s.scenarioId, s] as const))(
    "%s uses documentation address ranges only",
    (_id, scenario) => {
      const serialized = JSON.stringify(scenario.input);
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
    const { adapter } = resolveScenarioDomain(scenario.domainId);
    const proposal = structuredClone(scenario.proposal);
    proposal.diagnosis.evidenceIds.push("ev-ghost-claim");
    try {
      validateProposalEvidence(adapter, scenario.input as never, proposal);
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
      const { adapter } = resolveScenarioDomain(scenario.domainId);
      const { findings, riskLevel } = evaluatePolicies(adapter, scenario.input as never, scenario.proposal);

      expect(findings.map((finding) => finding.policyId)).toEqual(policyOrder(adapter));

      // Policy ids are open across domains, so exhaustiveness is proven here
      // rather than in the schema: a scenario must declare a verdict for every
      // policy this domain evaluates, and no others.
      expect(Object.keys(scenario.expectations.policies).sort()).toEqual(
        [...policyOrder(adapter)].sort(),
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
      const { adapter } = resolveScenarioDomain(scenario.domainId);
      const { findings } = evaluatePolicies(adapter, scenario.input as never, scenario.proposal);

      for (const [policyId, resources] of Object.entries(declared)) {
        const finding = findings.find((candidate) => candidate.policyId === policyId);
        expect(finding, `${policyId} finding missing`).toBeDefined();
        expect([...(finding?.affectedResources ?? [])].sort()).toEqual([...resources].sort());
      }
    },
  );

  it.each(
    SCENARIOS.filter((s) => resolveScenarioDomain(s.domainId).simulate === undefined).map(
      (s) => [s.scenarioId, s] as const,
    ),
  )("%s (external-diff domain) never declares a simulation outcome", (_id, scenario) => {
    // An external-diff domain (terraform) never simulates — the plan already
    // is the simulation — so a declared simulation outcome here would assert
    // a capability the domain does not have.
    expect(scenario.expectations.simulation).toBeNull();
  });
});

/** Walk a scenario to the point where the human decision is required. */
function advanceToDecision(scenario: ScenarioDefinition): WorkflowState {
  const { adapter } = resolveScenarioDomain(scenario.domainId);
  const { findings, riskLevel } = evaluatePolicies(adapter, scenario.input as never, scenario.proposal);
  let state: WorkflowState = initialState(scenario.scenarioId, scenario.input);
  state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
  state = transition(state, {
    type: "PROPOSAL_RECEIVED",
    proposal: scenario.proposal,
    mode: "replay",
    provenance: scenario.fixture?.provenance ?? null,
  });
  state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
  return transition(state, { type: "CLASSIFY" });
}

const approvableScenarios = SCENARIOS.filter((s) => s.expectations.approvable);
const blockedScenarios = SCENARIOS.filter((s) => !s.expectations.approvable);

// Simulated-state domains (network, kubernetes) walk the full human
// approve → simulate → receipt path the app drives. An external-diff domain
// (terraform) has no simulation step at all — its receipt path is the
// deterministic-gate one below, matching what `changesafe gate` actually does.
const simulableApprovable = approvableScenarios.filter(
  (s) => resolveScenarioDomain(s.domainId).simulate !== undefined,
);
const derivedApprovable = approvableScenarios.filter(
  (s) => resolveScenarioDomain(s.domainId).simulate === undefined,
);

describe.runIf(simulableApprovable.length > 0)("approvable scenarios (simulated-state domains)", () => {
  it.each(simulableApprovable.map((s) => [s.scenarioId, s] as const))(
    "%s runs approve → simulate → verified receipt",
    async (_id, scenario) => {
      const domain = resolveScenarioDomain(scenario.domainId);
      let state = advanceToDecision(scenario);
      expect(state.phase).toBe("APPROVAL_REQUIRED");

      state = transition(state, { type: "APPROVE" });
      const simulation = domain.simulate!(scenario.input, scenario.proposal);
      expect(simulation.safetyProperties.every((property) => property.satisfied)).toBe(
        scenario.expectations.simulation?.safetyPropertiesSatisfied,
      );
      state = transition(state, { type: "SIMULATION_COMPLETED", simulation });

      if (state.phase !== "SIMULATED") throw new Error("expected SIMULATED");
      const receipt = await createReceipt({
        sourceId: scenario.scenarioId,
        inputId: scenario.inputId,
        input: scenario.input,
        appVersion: "test",
        policyVersion: domain.adapter.policyVersion,
        proposal: scenario.proposal,
        mode: "replay",
        model: scenario.fixture?.model ?? null,
        fixtureProvenance: scenario.fixture?.provenance ?? null,
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

  it.each(simulableApprovable.map((s) => [s.scenarioId, s] as const))(
    "%s can also be rejected by the human",
    (_id, scenario) => {
      const state = transition(advanceToDecision(scenario), { type: "REJECT" });
      expect(state.phase).toBe("REJECTED");
    },
  );
});

describe.runIf(derivedApprovable.length > 0)("approvable scenarios (external-diff domains)", () => {
  it.each(derivedApprovable.map((s) => [s.scenarioId, s] as const))(
    "%s gates clean with a null-simulation, gate_only receipt",
    async (_id, scenario) => {
      const domain = resolveScenarioDomain(scenario.domainId);
      const { findings, riskLevel } = evaluatePolicies(
        domain.adapter,
        scenario.input as never,
        scenario.proposal,
      );
      expect(findings.some((finding) => finding.status === "BLOCK")).toBe(false);

      const receipt = await createReceipt({
        sourceId: scenario.scenarioId,
        inputId: scenario.inputId,
        input: scenario.input,
        appVersion: "test",
        policyVersion: domain.adapter.policyVersion,
        proposal: scenario.proposal,
        mode: "offline",
        model: null,
        fixtureProvenance: null,
        findings,
        riskLevel,
        decision: "gate_only",
        simulation: null,
      });
      expect(receipt.riskLevel).toBe(scenario.expectations.riskLevel);
      expect(receipt.simulation).toBeNull();
      expect(await verifyReceiptHash(receipt)).toBe(true);
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
      const donor = simulableApprovable[0];
      if (donor) {
        const donorDomain = resolveScenarioDomain(donor.domainId);
        const simulation = donorDomain.simulate!(donor.input, donor.proposal);
        expect(() =>
          transition(state, { type: "SIMULATION_COMPLETED", simulation }),
        ).toThrow(IllegalTransitionError);
      }
    },
  );

  it.each(blockedScenarios.map((s) => [s.scenarioId, s] as const))(
    "%s issues a blocked receipt with no simulation and rejects an approved one",
    async (_id, scenario) => {
      const domain = resolveScenarioDomain(scenario.domainId);
      const state = advanceToDecision(scenario);
      if (state.phase !== "BLOCKED") throw new Error("expected BLOCKED");
      // A domain with no fixture (terraform) was never "replayed" — its
      // proposal was handed to the gate directly, exactly as `gate.ts` does.
      const mode = scenario.fixture ? "replay" : "offline";

      const receipt = await createReceipt({
        sourceId: scenario.scenarioId,
        inputId: scenario.inputId,
        input: scenario.input,
        appVersion: "test",
        policyVersion: domain.adapter.policyVersion,
        proposal: scenario.proposal,
        mode,
        model: scenario.fixture?.model ?? null,
        fixtureProvenance: scenario.fixture?.provenance ?? null,
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
          inputId: scenario.inputId,
          input: scenario.input,
          appVersion: "test",
          policyVersion: domain.adapter.policyVersion,
          proposal: scenario.proposal,
          mode,
          model: scenario.fixture?.model ?? null,
          fixtureProvenance: scenario.fixture?.provenance ?? null,
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

  it("keeps a red-team scenario that the gate blocks outright", () => {
    // The flagship property: at least one adversarial scenario is refused by
    // the deterministic gate alone, with no sandbox and no human involved.
    const blockedOutright = SCENARIOS.filter(
      (s) => s.expectations.corpus.adversarial && !s.expectations.approvable,
    );
    expect(blockedOutright.length).toBeGreaterThan(0);
  });

  it("never ships an adversarial scenario that nothing catches", () => {
    // The general release gate. An adversarial scenario has to be stopped by
    // the gate or flagged by the sandbox; one that is approvable *and*
    // simulates cleanly is a change that got through, and shipping it as an
    // expected outcome would turn a failure into a documented feature.
    //
    // Deliberately broader than the old provenance-based check: it covers
    // every scenario the corpus calls adversarial, not only those whose
    // fixture happens to be labeled `authored_red_team`.
    const adversarial = SCENARIOS.filter((s) => s.expectations.corpus.adversarial);
    expect(adversarial.length).toBeGreaterThan(0);

    for (const scenario of adversarial) {
      const caughtByGate = !scenario.expectations.approvable;
      const caughtBySandbox = scenario.expectations.simulation?.safetyPropertiesSatisfied === false;
      expect(
        caughtByGate || caughtBySandbox,
        `${scenario.scenarioId} is adversarial but nothing catches it`,
      ).toBe(true);
    }
  });

  it("labels every adversarial scenario with what it is trying to get past", () => {
    for (const scenario of SCENARIOS.filter((s) => s.expectations.corpus.adversarial)) {
      expect(
        scenario.expectations.corpus.failureModes.length,
        `${scenario.scenarioId} names no failure mode`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps at least one scenario for every registered domain", () => {
    for (const domainId of SCENARIO_DOMAIN_IDS) {
      expect(
        SCENARIOS.some((s) => s.domainId === domainId),
        `no scenario registered for domain "${domainId}"`,
      ).toBe(true);
    }
  });
});
