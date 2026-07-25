import { IllegalTransitionError } from "./errors";
import { hasBlockingFinding, type PolicyFinding, type RiskLevel } from "./findings";
import type { AnalysisMode, FixtureProvenance } from "./analysis";
import type { ChangeProposal } from "./proposal";
import type { ChangeReceipt, ReceiptDecision } from "./receipt";
import type { SimulationResult } from "./simulation";

/**
 * The workflow state machine. Every arrow in the airlock is a case here;
 * anything else throws. Callers must drive the workflow through
 * `transition` rather than deriving state from rendered text, so an illegal
 * move is impossible even if a UI misbehaves.
 *
 *   READY -> ANALYZING -> PROPOSED -> VALIDATED
 *     VALIDATED -> BLOCKED -> RECEIPT_ISSUED
 *     VALIDATED -> APPROVAL_REQUIRED -> REJECTED -> RECEIPT_ISSUED
 *     APPROVAL_REQUIRED -> APPROVED -> SIMULATED -> RECEIPT_ISSUED
 *   recoverable failure -> ERROR -> READY (via RESET)
 *
 * `TInput` is whatever the active domain analyzes — an incident bundle, a
 * plan, a snapshot. Core never inspects it.
 */

interface SourceContext<TInput> {
  /** Where the input came from: a scenario id, a file, a pipeline run. */
  sourceId: string;
  input: TInput;
}

interface ProposalContext<TInput> extends SourceContext<TInput> {
  mode: AnalysisMode;
  /** Null in live mode; required provenance label when replaying a fixture. */
  provenance: FixtureProvenance | null;
  proposal: ChangeProposal;
}

interface ValidatedContext<TInput> extends ProposalContext<TInput> {
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
}

export type WorkflowState<TInput = unknown> =
  | ({ phase: "READY" } & SourceContext<TInput>)
  | ({ phase: "ANALYZING"; mode: AnalysisMode } & SourceContext<TInput>)
  | ({ phase: "PROPOSED" } & ProposalContext<TInput>)
  | ({ phase: "VALIDATED" } & ValidatedContext<TInput>)
  | ({ phase: "BLOCKED" } & ValidatedContext<TInput>)
  | ({ phase: "APPROVAL_REQUIRED" } & ValidatedContext<TInput>)
  | ({ phase: "APPROVED" } & ValidatedContext<TInput>)
  | ({ phase: "REJECTED" } & ValidatedContext<TInput>)
  | ({ phase: "SIMULATED"; simulation: SimulationResult } & ValidatedContext<TInput>)
  | ({
      phase: "RECEIPT_ISSUED";
      decision: ReceiptDecision;
      simulation: SimulationResult | null;
      receipt: ChangeReceipt;
    } & ValidatedContext<TInput>)
  // ERROR retains only a safe message — never a partial proposal or state.
  | ({ phase: "ERROR"; userMessage: string } & SourceContext<TInput>);

export type WorkflowPhase = WorkflowState["phase"];

export type WorkflowEvent<TInput = unknown> =
  | { type: "START_ANALYSIS"; mode: AnalysisMode }
  | {
      type: "PROPOSAL_RECEIVED";
      proposal: ChangeProposal;
      mode: AnalysisMode;
      provenance: FixtureProvenance | null;
    }
  | { type: "VALIDATION_COMPLETED"; findings: PolicyFinding[]; riskLevel: RiskLevel }
  /** Automatic and deterministic: VALIDATED -> BLOCKED | APPROVAL_REQUIRED. */
  | { type: "CLASSIFY" }
  /** Human-only events. Nothing in domain or AI code may dispatch these. */
  | { type: "APPROVE" }
  | { type: "REJECT" }
  | { type: "SIMULATION_COMPLETED"; simulation: SimulationResult }
  | { type: "RECEIPT_CREATED"; receipt: ChangeReceipt }
  | { type: "FAIL"; userMessage: string }
  | { type: "RESET"; sourceId: string; input: TInput };

export function initialState<TInput>(sourceId: string, input: TInput): WorkflowState<TInput> {
  return { phase: "READY", sourceId, input };
}

export { hasBlockingFinding };

/** Pure transition function; throws IllegalTransitionError on any move not in the spec. */
export function transition<TInput>(
  state: WorkflowState<TInput>,
  event: WorkflowEvent<TInput>,
): WorkflowState<TInput> {
  // RESET is the single universal arrow: any state returns to a clean READY.
  if (event.type === "RESET") {
    return initialState(event.sourceId, event.input);
  }

  switch (event.type) {
    case "START_ANALYSIS": {
      if (state.phase !== "READY" && state.phase !== "ERROR") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return {
        phase: "ANALYZING",
        sourceId: state.sourceId,
        input: state.input,
        mode: event.mode,
      };
    }

    case "PROPOSAL_RECEIVED": {
      if (state.phase !== "ANALYZING") {
        throw new IllegalTransitionError(state.phase, event.type);
      }
      return {
        phase: "PROPOSED",
        sourceId: state.sourceId,
        input: state.input,
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
        sourceId: state.sourceId,
        input: state.input,
        userMessage: event.userMessage,
      };
    }

    default: {
      const exhaustive: never = event;
      throw new IllegalTransitionError(state.phase, JSON.stringify(exhaustive));
    }
  }
}
