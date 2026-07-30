import {
  createReceipt,
  type AnalysisMode,
  type ChangeProposal,
  type ChangeReceipt,
  type FixtureProvenance,
  type PolicyFinding,
  type RiskLevel,
  type SimulationResult,
} from "@changesafe/core";
import {
  POLICY_VERSION,
  type IncidentBundle,
} from "@changesafe/domain-network";

import type { ReviewControllerState } from "../../reviews/controller";
import type { ReviewProvenance } from "../review-contract";

export interface CreateNetworkReviewReceiptOptions {
  readonly appVersion: string;
  readonly createdAtUtc?: string;
  readonly receiptId?: string;
}

/**
 * Creates the client-side record for a completed Network review.
 *
 * The decision and simulation are derived from the deterministic workflow,
 * rather than accepted from the caller. This keeps a console receipt bound to
 * the active review and preserves the airlock: this function only records a
 * human decision; it never executes an infrastructure change.
 */
export async function createNetworkReviewReceipt(
  state: ReviewControllerState<IncidentBundle>,
  options: CreateNetworkReviewReceiptOptions,
): Promise<ChangeReceipt> {
  if (state.session.domainId !== "network") {
    throw new Error("Network receipts require a Network review session");
  }
  if (state.session.policyVersion !== POLICY_VERSION) {
    throw new Error("Network receipt policy version does not match the active gate");
  }
  if (state.review === null) {
    throw new Error("Network receipts require a completed review");
  }

  const outcome = receiptOutcome(state);
  return createReceipt({
    sourceId: state.workflow.sourceId,
    inputId: state.expectedInputId,
    input: state.workflow.input,
    appVersion: options.appVersion,
    policyVersion: state.session.policyVersion,
    proposal: outcome.proposal,
    mode: outcome.mode,
    model: state.review.provenance.model,
    fixtureProvenance: coreFixtureProvenance(state.review.provenance.classification),
    findings: outcome.findings,
    riskLevel: outcome.riskLevel,
    decision: outcome.decision,
    simulation: outcome.simulation,
    createdAtUtc: options.createdAtUtc,
    receiptId: options.receiptId,
  });
}

interface ReceiptOutcome {
  readonly decision: ChangeReceipt["decision"];
  readonly simulation: SimulationResult | null;
  readonly proposal: ChangeProposal;
  readonly mode: AnalysisMode;
  readonly findings: PolicyFinding[];
  readonly riskLevel: RiskLevel;
}

function receiptOutcome(
  state: ReviewControllerState<IncidentBundle>,
): ReceiptOutcome {
  switch (state.workflow.phase) {
    case "SIMULATED":
      return {
        decision: "approved",
        simulation: state.workflow.simulation,
        proposal: state.workflow.proposal,
        mode: state.workflow.mode,
        findings: state.workflow.findings,
        riskLevel: state.workflow.riskLevel,
      };
    case "REJECTED":
      return {
        decision: "rejected",
        simulation: null,
        proposal: state.workflow.proposal,
        mode: state.workflow.mode,
        findings: state.workflow.findings,
        riskLevel: state.workflow.riskLevel,
      };
    case "BLOCKED":
      return {
        decision: "blocked",
        simulation: null,
        proposal: state.workflow.proposal,
        mode: state.workflow.mode,
        findings: state.workflow.findings,
        riskLevel: state.workflow.riskLevel,
      };
    default:
      throw new Error("Network receipts require a completed decision state");
  }
}

function coreFixtureProvenance(
  provenance: ReviewProvenance,
): FixtureProvenance | null {
  switch (provenance) {
    case "captured-replay":
      return "captured";
    case "authored-synthetic":
      return "authored_synthetic";
    case "authored-red-team":
      return "authored_red_team";
    case "live-model":
    case "uploaded-offline-artifact":
    case "read-only-collector":
      return null;
  }
}
