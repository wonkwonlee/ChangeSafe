import {
  AnalyzeRequestSchema,
  AnalyzeSuccessSchema,
  type AnalyzeError,
  type ApiErrorCode,
} from "@/lib/domain/api";
import { isDomainError } from "@changesafe/core";
import { analyzeLive, isLiveConfigured } from "@/lib/ai/live";
import { analyzeReplay } from "@/lib/ai/replay";
import { getScenario } from "@/scenarios";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096; // { scenarioId, mode } — anything bigger is not our client

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  const body: AnalyzeError = {
    error: { code, message, replayAvailable: true },
  };
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  let parsedBody: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return errorResponse(413, "REQUEST_INVALID", "Request body is too large.");
    }
    parsedBody = JSON.parse(text);
  } catch {
    return errorResponse(400, "REQUEST_INVALID", "Request body must be valid JSON.");
  }

  const parsedRequest = AnalyzeRequestSchema.safeParse(parsedBody);
  if (!parsedRequest.success) {
    return errorResponse(
      400,
      "REQUEST_INVALID",
      "Request must be { scenarioId, mode: 'live' | 'replay' }.",
    );
  }
  const { scenarioId, mode } = parsedRequest.data;

  const scenario = getScenario(scenarioId);
  if (!scenario) {
    return errorResponse(404, "SCENARIO_UNKNOWN", `Unknown scenario "${scenarioId}".`);
  }

  try {
    if (mode === "live") {
      if (!isLiveConfigured()) {
        return errorResponse(
          503,
          "AI_UNAVAILABLE",
          "Live mode is not configured on this server. Switch to replay mode.",
        );
      }
      const { proposal, model } = await analyzeLive(scenario.bundle);
      return Response.json(
        AnalyzeSuccessSchema.parse({
          mode: "live",
          model,
          provenance: null,
          fixtureId: null,
          fixtureNotes: null,
          proposal,
        }),
      );
    }

    const replay = analyzeReplay(scenarioId);
    return Response.json(
      AnalyzeSuccessSchema.parse({
        mode: "replay",
        model: replay.model,
        provenance: replay.provenance,
        fixtureId: replay.fixtureId,
        fixtureNotes: replay.fixtureNotes,
        proposal: replay.proposal,
      }),
    );
  } catch (error) {
    // Typed domain errors carry safe user messages; anything else is masked.
    if (isDomainError(error)) {
      const status =
        error.code === "AI_UNAVAILABLE" ? 503
        : error.code === "AI_CALL_FAILED" ? 502
        : error.code === "AI_INVALID_OUTPUT" || error.code === "EVIDENCE_UNKNOWN" ? 502
        : 500;
      const code: ApiErrorCode =
        error.code === "AI_UNAVAILABLE" || error.code === "AI_CALL_FAILED"
          ? error.code
          : error.code === "AI_INVALID_OUTPUT" || error.code === "EVIDENCE_UNKNOWN"
            ? "AI_INVALID_OUTPUT"
            : "INTERNAL";
      return errorResponse(status, code, error.userMessage);
    }
    return errorResponse(500, "INTERNAL", "Analysis failed unexpectedly. No proposal was accepted.");
  }
}
