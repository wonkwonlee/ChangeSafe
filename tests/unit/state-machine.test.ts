import { describe, expect, it } from "vitest";

import { IllegalTransitionError } from "@/lib/domain/errors";
import {
  initialState,
  transition,
  type WorkflowState,
} from "@/lib/domain/state-machine";
import {
  buildFinding,
  buildIncidentBundle,
  buildProposal,
  buildReceipt,
  buildSimulation,
} from "@/tests/helpers/fixtures";

const bundle = buildIncidentBundle();

function ready(): WorkflowState {
  return initialState("scenario-test", bundle);
}

function proposed(): WorkflowState {
  let state = ready();
  state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
  state = transition(state, {
    type: "PROPOSAL_RECEIVED",
    proposal: buildProposal(),
    mode: "replay",
    provenance: "authored_synthetic",
  });
  return state;
}

function approvalRequired(): WorkflowState {
  let state = proposed();
  state = transition(state, {
    type: "VALIDATION_COMPLETED",
    findings: [buildFinding("PASS")],
    riskLevel: "LOW",
  });
  return transition(state, { type: "CLASSIFY" });
}

function blocked(): WorkflowState {
  let state = proposed();
  state = transition(state, {
    type: "VALIDATION_COMPLETED",
    findings: [buildFinding("BLOCK", { policyId: "MGMT_REACHABILITY" })],
    riskLevel: "CRITICAL",
  });
  return transition(state, { type: "CLASSIFY" });
}

describe("workflow happy path", () => {
  it("walks READY through SIMULATED to RECEIPT_ISSUED", () => {
    let state = approvalRequired();
    expect(state.phase).toBe("APPROVAL_REQUIRED");
    state = transition(state, { type: "APPROVE" });
    expect(state.phase).toBe("APPROVED");
    state = transition(state, {
      type: "SIMULATION_COMPLETED",
      simulation: buildSimulation(),
    });
    expect(state.phase).toBe("SIMULATED");
    state = transition(state, {
      type: "RECEIPT_CREATED",
      receipt: buildReceipt({ decision: "approved", simulation: buildSimulation() }),
    });
    expect(state.phase).toBe("RECEIPT_ISSUED");
    if (state.phase === "RECEIPT_ISSUED") {
      expect(state.decision).toBe("approved");
      expect(state.simulation).not.toBeNull();
    }
  });

  it("supports the rejection path", () => {
    let state = approvalRequired();
    state = transition(state, { type: "REJECT" });
    expect(state.phase).toBe("REJECTED");
    state = transition(state, {
      type: "RECEIPT_CREATED",
      receipt: buildReceipt({ decision: "rejected" }),
    });
    expect(state.phase).toBe("RECEIPT_ISSUED");
    if (state.phase === "RECEIPT_ISSUED") {
      expect(state.decision).toBe("rejected");
    }
  });
});

describe("blocked proposals", () => {
  it("classifies BLOCK findings into BLOCKED", () => {
    expect(blocked().phase).toBe("BLOCKED");
  });

  it("can never be approved", () => {
    expect(() => transition(blocked(), { type: "APPROVE" })).toThrow(IllegalTransitionError);
  });

  it("can never be simulated", () => {
    expect(() =>
      transition(blocked(), { type: "SIMULATION_COMPLETED", simulation: buildSimulation() }),
    ).toThrow(IllegalTransitionError);
  });

  it("issues a blocked receipt directly", () => {
    const state = transition(blocked(), {
      type: "RECEIPT_CREATED",
      receipt: buildReceipt({ decision: "blocked" }),
    });
    expect(state.phase).toBe("RECEIPT_ISSUED");
    if (state.phase === "RECEIPT_ISSUED") {
      expect(state.decision).toBe("blocked");
      expect(state.simulation).toBeNull();
    }
  });

  it("refuses APPROVE even if a BLOCK finding sneaks into APPROVAL_REQUIRED", () => {
    let state = proposed();
    state = transition(state, {
      type: "VALIDATION_COMPLETED",
      findings: [buildFinding("PASS")],
      riskLevel: "LOW",
    });
    state = transition(state, { type: "CLASSIFY" });
    // Simulate hostile in-memory tampering with the validated findings.
    const tampered = {
      ...state,
      findings: [buildFinding("BLOCK", { policyId: "PROTECTED_RESOURCE" })],
    } as WorkflowState;
    expect(() => transition(tampered, { type: "APPROVE" })).toThrow(IllegalTransitionError);
  });
});

describe("failure and reset behavior", () => {
  it("FAIL from ANALYZING produces ERROR with no proposal retained", () => {
    let state = ready();
    state = transition(state, { type: "START_ANALYSIS", mode: "live" });
    state = transition(state, { type: "FAIL", userMessage: "The live analysis call failed." });
    expect(state.phase).toBe("ERROR");
    expect("proposal" in state).toBe(false);
    expect("findings" in state).toBe(false);
  });

  it("RESET returns a clean READY from every phase", () => {
    const states = [ready(), proposed(), approvalRequired(), blocked()];
    for (const state of states) {
      const reset = transition(state, {
        type: "RESET",
        scenarioId: "scenario-test",
        bundle,
      });
      expect(reset.phase).toBe("READY");
      expect("proposal" in reset).toBe(false);
    }
  });

  it("ERROR can start a fresh analysis", () => {
    let state = ready();
    state = transition(state, { type: "START_ANALYSIS", mode: "live" });
    state = transition(state, { type: "FAIL", userMessage: "boom" });
    state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
    expect(state.phase).toBe("ANALYZING");
  });
});

describe("illegal transitions", () => {
  it("rejects APPROVE from READY", () => {
    expect(() => transition(ready(), { type: "APPROVE" })).toThrow(IllegalTransitionError);
  });

  it("rejects SIMULATION_COMPLETED before approval", () => {
    expect(() =>
      transition(approvalRequired(), {
        type: "SIMULATION_COMPLETED",
        simulation: buildSimulation(),
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("rejects RECEIPT_CREATED from APPROVED (simulation must complete first)", () => {
    const state = transition(approvalRequired(), { type: "APPROVE" });
    expect(() =>
      transition(state, {
        type: "RECEIPT_CREATED",
        receipt: buildReceipt({ decision: "approved", simulation: buildSimulation() }),
      }),
    ).toThrow(IllegalTransitionError);
  });

  it("rejects PROPOSAL_RECEIVED outside ANALYZING", () => {
    expect(() =>
      transition(ready(), {
        type: "PROPOSAL_RECEIVED",
        proposal: buildProposal(),
        mode: "replay",
        provenance: "authored_synthetic",
      }),
    ).toThrow(IllegalTransitionError);
  });
});
