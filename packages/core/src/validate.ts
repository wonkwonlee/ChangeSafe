import type { DomainAdapter } from "./domain";
import { DomainError } from "./errors";
import type { ChangeProposal } from "./proposal";

/**
 * Hard boundary check applied to every proposal (live or replay) before any
 * policy or patch processing: a proposal citing evidence that does not exist
 * in the input is rejected outright. Invented evidence is a validation
 * failure, not a policy finding — there is nothing to weigh.
 */
export function validateProposalEvidence<TInput, TState>(
  adapter: DomainAdapter<TInput, TState>,
  input: TInput,
  proposal: ChangeProposal,
): void {
  const known = adapter.knownEvidenceIds(input);
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
      `The proposal cites evidence that does not exist in the input: ${unknown.join(", ")}. Proposals must reference real evidence ids only.`,
    );
  }
}
