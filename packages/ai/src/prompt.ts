import type { z } from "zod";
import { DomainError, type ChangeProposal } from "@changesafe/core";

/**
 * What a domain must supply for a model to propose changes in it.
 *
 * The split matters: `systemInstructions` is trusted text the operator wrote,
 * `buildUserContent` returns untrusted incident data wrapped in delimiters,
 * and `crossCheck` is the domain's own verification that the returned
 * proposal refers only to things that actually exist. A provider sits between
 * the second and the third and is trusted for neither.
 */
export interface AnalysisPrompt<TInput> {
  readonly domainId: string;
  /** Schema name sent to the provider; also the tool name on Anthropic. */
  readonly schemaName: string;
  /** Drives both the provider's wire schema and the local parse. */
  readonly proposalSchema: z.ZodType<ChangeProposal>;
  readonly systemInstructions: string;
  buildUserContent(input: TInput): string;
  /**
   * Reject a schema-valid proposal that refers to things the input does not
   * contain. Must throw a DomainError; returning normally means accepted.
   */
  crossCheck(input: TInput, proposal: ChangeProposal): void;
}

/**
 * Local validation of anything claiming to be a model-produced proposal.
 *
 * This runs regardless of what the provider promised. Structured output
 * constrains generation; it does not make the result true, and providers vary
 * in how much of a schema they enforce. Parsing with the full Zod schema
 * restores every constraint the portable wire schema had to drop, and the
 * domain's cross-check catches the failure schemas cannot express: a
 * confident, well-formed proposal about identifiers that do not exist.
 */
export function validateModelProposal<TInput>(
  prompt: AnalysisPrompt<TInput>,
  input: TInput,
  data: unknown,
): ChangeProposal {
  const parsed = prompt.proposalSchema.safeParse(data);
  if (!parsed.success) {
    throw new DomainError(
      "AI_INVALID_OUTPUT",
      "The model returned output that does not match the ChangeProposal schema. No proposal was accepted.",
    );
  }
  const proposal = parsed.data;
  prompt.crossCheck(input, proposal);
  return proposal;
}
