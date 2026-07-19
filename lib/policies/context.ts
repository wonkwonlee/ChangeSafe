import type { ChangeProposal, IncidentBundle } from "@/lib/domain/schemas";

/**
 * Input to every policy. Policies are pure functions of this context: no LLM
 * calls, no IO, no randomness, no clock. Model confidence is deliberately not
 * part of any policy's inputs.
 */
export interface PolicyContext {
  bundle: IncidentBundle;
  proposal: ChangeProposal;
}
