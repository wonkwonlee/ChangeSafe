import { IllegalTransitionError } from "./errors";
import type {
  AnalysisMode,
  ChangeProposal,
  ChangeReceipt,
  FixtureProvenance,
  IncidentBundle,
  PolicyFinding,
  ReceiptDecision,
  RiskLevel,
  SimulationResult,
} from "./schemas";

/**
 * Explicit workflow state machine. Every arrow in the product spec is a case
 * here; anything else throws IllegalTransitionError. The UI must call
 * `transition` (via its reducer) rather than deriving state from rendered
 * text, so illegal moves are impossible even if buttons misbehave.
 *
 *   READY -> ANALYZING -> PROPOSED -> VALIDATED
 *     VALIDATED -> BLOCKED -> RECEIPT_ISSUED
 *     VALIDATED -> APPROVAL_REQUIRED -> REJECTED -> RECEIPT_ISSUED
 *     APPROVAL_REQUIRED -> APPROVED -> SIMULATED -> RECEIPT_ISSUED
 *   recoverable failure -> ERROR -> READY (via RESET)
 */

interface ScenarioContext {
  scenarioId: string;
  bundle: IncidentBundle;
}

interface ProposalContext extends ScenarioContext {
  mode: AnalysisMode;
  /** Null in live mode; required provenance label when replaying a fixture. */
  provenance: FixtureProvenance | null;
  proposal: ChangeProposal;
}

interface ValidatedContext extends ProposalContext {
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
}

export type WorkflowState =
  | ({ phase: "READY" } & ScenarioContext)
  | ({ phase: "ANALYZING"; mode: AnalysisMode } & ScenarioContext)
  | ({ phase: "PROPOSED" } & ProposalContext)
  | ({ phase: "VALIDATED" } & ValidatedContext)
  | ({ phase: "BLOCKED" } & ValidatedContext)
  | ({ phase: "APPROVAL_REQUIRED" } & ValidatedContext)
  | ({ phase: "APPROVED" } & ValidatedContext)
  | ({ phase: "REJECTED" } & ValidatedContext)
  | ({ phase: "SIMULATED"; simulation: SimulationResult } & ValidatedContext)
  | ({
      phase: "RECEIPT_ISSUED";
      decision: ReceiptDecision;
      simulation: SimulationResult | null;
      receipt: ChangeReceipt;
    } & ValidatedContext)
  // ERROR retains only a safe message — never a partial proposal or mutated state.
  | ({ phase: "ERROR"; userMessage: string } & ScenarioContext);

export type WorkflowPhase = WorkflowState["phase"];

export type WorkflowEvent =
  | { type: "START_ANALYSIS"; mode: AnalysisMode }
  | {
      type: "PROPOSAL_RECEIVED";
      proposal: ChangeProposal;
      mode: AnalysisMode;
      provenance: FixtureProvenance | null;
    }
  | { type: "VALIDATION_COMPLETED"; findings: PolicyFinding[]; riskLevel: RiskLevel }
  /** Automatic, deterministic: VALIDATED -> BLOCKED | APPROVAL_REQUIRED from findings. */
  | { type: "CLASSIFY" }
  /** Human-only events. Nothing in domain or AI code may dispatch these. */
  | { type: "APPROVE" }
  | { type: "REJECT" }
  | { type: "SIMULATION_COMPLETED"; simulation: SimulationResult }
  | { type: "RECEIPT_CREATED"; receipt: ChangeReceipt }
  | { type: "FAIL"; userMessage: string }
  | { type: "RESET"; scenarioId: string; bundle: IncidentBundle };

export function initialState(scenarioId: string, bundle: IncidentBundle): WorkflowState {
  return { phase: "READY", scenarioId, bundle };
}

export function hasBlockingFinding(findings: PolicyFinding[]): boolean {
  return findings.some((finding) => finding.status === "BLOCK");
}

/** Pure transition function; throws IllegalTransitionError on any move not in the spec. */
export function transition(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  // RESET is the single universal arrow: any state returns to a clean READY.
  if (event.type === "RESET") {
    return initialState(event.scenarioId, event.bundle);
  }

  switch (event.type) {
    case "START_ANALYSIS": {
      if (state.phase !== "READY" && state.phase !== "ERROR") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return {
        phase: "ANALYZING",
        scenarioId: state.scenarioId,
        bundle: state.bundle,
        mode: event.mode,
      };
    }

    case "PROPOSAL_RECEIVED": {
      if (state.phase !== "ANALYZING") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return {
        phase: "PROPOSED",
        scenarioId: state.scenarioId,
        bundle: state.bundle,
        mode: event.mode,
        provenance: event.provenance,
        proposal: event.proposal,
      };
    }

    case "VALIDATION_COMPLETED": {
      if (state.phase !== "PROPOSED") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return {
        ...state,
        phase: "VALIDATED",
        findings: event.findings,
        riskLevel: event.riskLevel,
      };
    }

    case "CLASSIFY": {
      if (state.phase !== "VALIDATED") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      // Derived from findings inside the machine — callers cannot choose the branch.
      return hasBlockingFinding(state.findings)
        ? { ...state, phase: "BLOCKED" }
        : { ...state, phase: "APPROVAL_REQUIRED" };
    }

    case "APPROVE": {
      if (state.phase !== "APPROVAL_REQUIRED") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      // Defense in depth: even a mislabeled state can never approve BLOCK findings.
      if (hasBlockingFinding(state.findings)) {
        throw new IllegalTransitionError(
          state.phase,
          event.type,
          "proposal has BLOCK findings and can never be approved",
        );
      }
      return { ...state, phase: "APPROVED" };
    }

    case "REJECT": {
      if (state.phase !== "APPROVAL_REQUIRED") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return { ...state, phase: "REJECTED" };
    }

    case "SIMULATION_COMPLETED": {
      if (state.phase !== "APPROVED") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return { ...state, phase: "SIMULATED", simulation: event.simulation };
    }

    case "RECEIPT_CREATED": {
      if (state.phase === "BLOCKED") {
        return {
          ...state,
          phase: "RECEIPT_ISSUED",
          decision: "blocked",
          simulation: null,
          receipt: event.receipt,
        };
      }
      if (state.phase === "REJECTED") {
        return {
          ...state,
          phase: "RECEIPT_ISSUED",
          decision: "rejected",
          simulation: null,
          receipt: event.receipt,
        };
      }
      if (state.phase === "SIMULATED") {
        return {
          ...state,
          phase: "RECEIPT_ISSUED",
          decision: "approved",
          simulation: state.simulation,
          receipt: event.receipt,
        };
      }
      throw new IllegalTransitionError(state.phase, event.type);
    }

    case "FAIL": {
      const recoverable: WorkflowPhase[] = ["ANALYZING", "PROPOSED", "VALIDATED", "APPROVED"];
      if (!recoverable.includes(state.phase)) {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      // Drop proposal/findings entirely; ERROR keeps only the safe message.
      return {
        phase: "ERROR",
        scenarioId: state.scenarioId,
        bundle: state.bundle,
        userMessage: event.userMessage,
      };
    }

    default: {
      const exhaustive: never = event;
      throw new IllegalTransitionError(state.phase, JSON.stringify(exhaustive));
    }
  }
}
