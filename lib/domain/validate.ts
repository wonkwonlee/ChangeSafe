import { DomainError } from "./errors";
import type { ChangeProposal, IncidentBundle } from "./schemas";

/** Every evidence id that exists in the bundle (alerts + operator notes). */
export function collectKnownEvidenceIds(bundle: IncidentBundle): Set<string> {
  return new Set([
    ...bundle.alerts.map((alert) => alert.evidenceId),
    ...bundle.operatorNotes.map((note) => note.evidenceId),
  ]);
}

/**
 * Hard boundary check applied to every proposal (live or replay) before any
 * policy or patch processing: a proposal citing evidence ids that do not exist
 * in the bundle is rejected outright — invented evidence is a validation
 * failure, not a policy finding.
 */
export function validateProposalEvidence(
  bundle: IncidentBundle,
  proposal: ChangeProposal,
): void {
  const known = collectKnownEvidenceIds(bundle);
  const cited = new Set<string>([
    ...proposal.diagnosis.evidenceIds,
    ...proposal.operations.flatMap((operation) => operation.evidenceIds),
    ...proposal.rollbackOperations.flatMap((operation) => operation.evidenceIds),
    ...proposal.verificationSteps.flatMap((step) => step.evidenceIds),
  ]);

  const unknown = [...cited].filter((evidenceId) => !known.has(evidenceId)).sort();
  if (unknown.length > 0) {
    throw new DomainError(
      "EVIDENCE_UNKNOWN",
      `The proposal cites evidence that does not exist in the incident: ${unknown.join(", ")}. Proposals must reference real evidence ids only.`,
    );
  }
}
