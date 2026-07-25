import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { DomainError } from "@changesafe/core";
import { ChangeProposalSchema, type ChangeProposal } from "@changesafe/core";
import { type IncidentBundle } from "@changesafe/domain-network";
import { RUNTIME_MODEL } from "@/lib/domain/version";
import { buildAnalysisInput, SYSTEM_INSTRUCTIONS } from "./prompt";
import { validateModelProposal } from "./validate-model-output";

// Server-only module: the API key must never reach the browser.
if (typeof window !== "undefined") {
  throw new Error("lib/ai/live is server-only and must never be imported by client code");
}

export interface LiveAnalysis {
  proposal: ChangeProposal;
  model: string;
}

/** Narrow injection point so tests can exercise validation without network. */
export interface ResponsesParser {
  parse(params: {
    model: string;
    instructions: string;
    input: string;
    reasoning: { effort: "low" };
    max_output_tokens: number;
    text: { format: ReturnType<typeof zodTextFormat> };
  }): Promise<{ output_parsed: unknown; status?: string }>;
}

export function isLiveConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Live GPT-5.6 analysis through the Responses API with Structured Outputs.
 * The bundle rides inside untrusted-data delimiters; the returned object is
 * accepted only after local validation (schema, evidence ids, device refs).
 */
export async function analyzeLive(
  bundle: IncidentBundle,
  parser?: ResponsesParser,
): Promise<LiveAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!parser && !apiKey) {
    throw new DomainError(
      "AI_UNAVAILABLE",
      "Live mode is not configured on this server. Replay mode is available.",
    );
  }

  const responses: ResponsesParser =
    parser ?? new OpenAI({ apiKey }).responses;

  let raw: { output_parsed: unknown; status?: string };
  try {
    raw = await responses.parse({
      model: RUNTIME_MODEL,
      instructions: SYSTEM_INSTRUCTIONS,
      input: buildAnalysisInput(bundle),
      // Restrained reasoning keeps the demo fast; policies do the real safety work.
      reasoning: { effort: "low" },
      max_output_tokens: 8192,
      text: { format: zodTextFormat(ChangeProposalSchema, "change_proposal") },
    });
  } catch (error) {
    throw toSafeCallError(error);
  }

  if (raw.status === "incomplete" || raw.output_parsed === null || raw.output_parsed === undefined) {
    throw new DomainError(
      "AI_INVALID_OUTPUT",
      "The model did not return a complete structured proposal. No proposal was accepted.",
    );
  }

  const proposal = validateModelProposal(bundle, raw.output_parsed);
  return { proposal, model: RUNTIME_MODEL };
}

/**
 * Collapse SDK/network failures into a safe, typed error. Only the HTTP
 * status is preserved — request bodies, headers, and key material never
 * reach a user-visible message.
 */
function toSafeCallError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const suffix = typeof status === "number" ? ` (upstream status ${status})` : "";
  return new DomainError(
    "AI_CALL_FAILED",
    `The live GPT-5.6 analysis call failed${suffix}. You can retry or switch to replay mode.`,
    { cause: error },
  );
}
