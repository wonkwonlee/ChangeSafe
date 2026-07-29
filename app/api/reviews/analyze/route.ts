import { z } from "zod";
import { type FixtureProvenance } from "@changesafe/core";

import { DOMAIN_REGISTRY } from "@/features/domains/registry";
import {
  REVIEW_CONTRACT_VERSION,
  DomainIdSchema,
  ReviewAnalysisResultSchema,
  type ReviewContractErrorResult,
  type ReviewProvenance,
  type ReviewTransportErrorDetail,
} from "@/features/domains/review-contract";
import {
  composeSessionCapabilities,
  defineTransportCapabilitySource,
} from "@/features/domains/runtime";
import {
  REVIEW_ANALYZE_API_VERSION,
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeRequestV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "@/features/domains/review-api-contract";
import { getScenario } from "@/scenarios";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4096;
const publicReplayTransport = defineTransportCapabilitySource({
  durableDecision: false,
});

const ReviewAnalyzeResolutionRequestSchema =
  ReviewAnalyzeRequestV1Schema.extend({
    domainId: DomainIdSchema,
    contractVersion: z.string().min(1).max(64),
  });

interface ParsedBody {
  readonly ok: true;
  readonly value: unknown;
}

interface RejectedBody {
  readonly ok: false;
  readonly response: Response;
}

type BodyResult = ParsedBody | RejectedBody;

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedJson(request);
  if (!body.ok) {
    return body.response;
  }

  const resolutionRequest = ReviewAnalyzeResolutionRequestSchema.safeParse(
    body.value,
  );
  if (!resolutionRequest.success) {
    return requestInvalid(
      400,
      "Request must match the versioned review analysis contract.",
    );
  }

  const resolution = DOMAIN_REGISTRY.resolve(
    resolutionRequest.data.domainId,
    resolutionRequest.data.contractVersion,
  );
  if (!resolution.ok) {
    return registryError(resolution);
  }

  const parsedRequest = ReviewAnalyzeRequestV1Schema.safeParse(body.value);
  if (!parsedRequest.success) {
    return requestInvalid(
      400,
      "Request must match the versioned review analysis contract.",
    );
  }

  const { domainId, sourceId, analysisMode } = parsedRequest.data;
  if (domainId !== "network") {
    return sourceUnknown(domainId);
  }

  const scenario = getScenario(sourceId);
  if (!scenario) {
    return sourceUnknown(domainId);
  }

  if (analysisMode !== "replay") {
    return transportError(503, {
      code: "ANALYSIS_UNAVAILABLE",
      message:
        "This route currently supports validated bundled replay analysis only.",
      domainId,
      replayAvailable: true,
      replaySource: {
        domainId,
        contractVersion: REVIEW_CONTRACT_VERSION,
        sourceId,
      },
      expectedContractVersion: null,
      receivedContractVersion: null,
    });
  }

  try {
    const entry = await resolution.load();
    const evaluation = entry.runtime.evaluate(
      scenario.bundle,
      scenario.fixture.proposal,
    );
    const provenance = reviewProvenance(scenario.fixture.provenance);
    const source =
      provenance === "captured-replay"
        ? "bundled-replay"
        : "authored-fixture";
    const result = ReviewAnalysisResultSchema.parse({
      ok: true,
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainId,
      session: {
        domainId,
        contractVersion: REVIEW_CONTRACT_VERSION,
        domainShape: entry.runtime.domainShape,
        capabilities: composeSessionCapabilities(
          entry.runtime,
          "public-replay",
          publicReplayTransport,
        ),
        runtimeMode: "public-replay",
        source,
        analysisMode,
        provenance,
      },
      sourceId,
      inputId: scenario.bundle.incidentId,
      input: scenario.bundle,
      proposal: scenario.fixture.proposal,
      findings: evaluation.findings,
      riskLevel: evaluation.riskLevel,
      provenance: {
        classification: provenance,
        model: scenario.fixture.model,
        provider: null,
        fixtureId: scenario.fixture.fixtureId,
        notes: scenario.fixture.notes,
      },
      effectCapability: {
        kind: "sandbox-simulation",
      },
    });

    return Response.json(
      ReviewAnalyzeSuccessV1Schema.parse({
        apiVersion: REVIEW_ANALYZE_API_VERSION,
        result,
      }),
    );
  } catch {
    return transportError(500, {
      code: "INTERNAL",
      message:
        "Review analysis failed safely. No proposal or policy result was accepted.",
      domainId,
      replayAvailable: false,
      expectedContractVersion: null,
      receivedContractVersion: null,
    });
  }
}

async function readBoundedJson(request: Request): Promise<BodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_BODY_BYTES
  ) {
    return {
      ok: false,
      response: requestInvalid(413, "Request body is too large."),
    };
  }

  if (request.body === null) {
    return {
      ok: false,
      response: requestInvalid(400, "Request body must be valid JSON."),
    };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          response: requestInvalid(413, "Request body is too large."),
        };
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: requestInvalid(400, "Request body must be valid JSON."),
    };
  }
}

function registryError(resolution: ReviewContractErrorResult): Response {
  switch (resolution.error.code) {
    case "UNKNOWN_DOMAIN":
      return transportError(404, {
        code: "UNKNOWN_DOMAIN",
        message: "No registered review domain matches the request.",
        domainId: resolution.error.domainId,
        replayAvailable: false,
        expectedContractVersion: null,
        receivedContractVersion: null,
      });
    case "CONTRACT_VERSION_MISMATCH":
      return transportError(409, {
        code: "CONTRACT_VERSION_MISMATCH",
        message: "The requested review contract version is unsupported.",
        domainId: resolution.error.domainId,
        replayAvailable: false,
        expectedContractVersion:
          resolution.error.expectedContractVersion,
        receivedContractVersion:
          resolution.error.receivedContractVersion,
      });
  }
}

function requestInvalid(status: number, message: string): Response {
  return transportError(status, {
    code: "REQUEST_INVALID",
    message,
    domainId: null,
    replayAvailable: false,
    expectedContractVersion: null,
    receivedContractVersion: null,
  });
}

function sourceUnknown(domainId: string): Response {
  return transportError(404, {
    code: "SOURCE_UNKNOWN",
    message: "No validated bundled replay source matches the request.",
    domainId,
    replayAvailable: false,
    expectedContractVersion: null,
    receivedContractVersion: null,
  });
}

function transportError(
  status: number,
  error: ReviewTransportErrorDetail,
): Response {
  return Response.json(
    ReviewAnalyzeErrorV1Schema.parse({
      apiVersion: REVIEW_ANALYZE_API_VERSION,
      result: {
        ok: false,
        contractVersion: REVIEW_CONTRACT_VERSION,
        error,
      },
    }),
    { status },
  );
}

function reviewProvenance(
  provenance: FixtureProvenance,
): ReviewProvenance {
  switch (provenance) {
    case "captured":
      return "captured-replay";
    case "authored_synthetic":
      return "authored-synthetic";
    case "authored_red_team":
      return "authored-red-team";
  }
}
