import { DomainError } from "@/lib/domain/errors";
import { ChangeProposalSchema, type ChangeProposal, type IncidentBundle } from "@/lib/domain/schemas";
import { validateProposalEvidence } from "@/lib/domain/validate";
import { parsePatchPath } from "@/lib/patch/paths";

/**
 * Local validation layer for anything claiming to be a model-produced
 * proposal. Runs after (and independently of) Structured Outputs enforcement:
 * 1. strict Zod parse, 2. evidence ids must exist in the bundle, 3. parseable
 * operation paths must reference devices that exist in the current state.
 * Failure throws a typed DomainError and no partial proposal escapes.
 */
export function validateModelProposal(bundle: IncidentBundle, data: unknown): ChangeProposal {
  const parsed = ChangeProposalSchema.safeParse(data);
  if (!parsed.success) {
    throw new DomainError(
      "AI_INVALID_OUTPUT",
      "The model returned output that does not match the ChangeProposal schema. No proposal was accepted.",
    );
  }
  const proposal = parsed.data;

  // Invented evidence ids are a hard rejection (EVIDENCE_UNKNOWN).
  validateProposalEvidence(bundle, proposal);

  // Parseable paths must reference real devices; malformed paths are left to
  // the PATCH_SCHEMA policy so they surface as explained findings.
  const unknownDevices = new Set<string>();
  for (const operation of [...proposal.operations, ...proposal.rollbackOperations]) {
    const parsedPath = parsePatchPath(operation.path);
    if (parsedPath && !bundle.currentState.devices[parsedPath.deviceId]) {
      unknownDevices.add(parsedPath.deviceId);
    }
  }
  if (unknownDevices.size > 0) {
    throw new DomainError(
      "AI_INVALID_OUTPUT",
      `The model referenced devices that do not exist in the incident state: ${[...unknownDevices].sort().join(", ")}. No proposal was accepted.`,
    );
  }

  return proposal;
}
