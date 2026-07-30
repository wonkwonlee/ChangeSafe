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
import { TERRAFORM_PUBLIC_REPLAY_FIXTURES } from "@/features/domains/terraform/fixtures";
import { getScenario } from "@/scenarios";
import type { IncidentBundle } from "@changesafe/domain-network";

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

interface PublicReplayInput {
  readonly inputId: string;
  readonly input: unknown;
  readonly proposal: unknown;
  readonly source: "bundled-replay" | "authored-fixture";
  readonly provenance: ReviewProvenance;
  readonly proposalProvenance: {
    readonly model: string | null;
    readonly fixtureId: string;
    readonly notes: string | null;
  };
  readonly effectCapability: "sandbox-simulation" | "external-diff";
}

interface UnsupportedPublicReplaySource {
  readonly kind: "unsupported";
}

type PublicReplayResolution = PublicReplayInput | UnsupportedPublicReplaySource | null;

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
  let replayResolution: PublicReplayResolution;
  try {
    replayResolution = await resolvePublicReplay(domainId, sourceId);
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
  if (!replayResolution) {
    return sourceUnknown(domainId);
  }
  if (isUnsupportedReplaySource(replayResolution)) {
    return unsupportedSource(domainId);
  }
  const replay = replayResolution;

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
      replay.input,
      replay.proposal,
    );
    const result = ReviewAnalysisResultSchema.parse({
      ok: true,
      contractVersion: REVIEW_CONTRACT_VERSION,
      domainId,
      session: {
        domainId,
        contractVersion: REVIEW_CONTRACT_VERSION,
        policyVersion: entry.runtime.policyVersion,
        domainShape: entry.runtime.domainShape,
        capabilities: composeSessionCapabilities(
          entry.runtime,
          "public-replay",
          publicReplayTransport,
        ),
        runtimeMode: "public-replay",
        source: replay.source,
        analysisMode,
        provenance: replay.provenance,
      },
      sourceId,
      inputId: replay.inputId,
      input: replay.input,
      proposal: replay.proposal,
      findings: evaluation.findings,
      riskLevel: evaluation.riskLevel,
      provenance: {
        classification: replay.provenance,
        model: replay.proposalProvenance.model,
        provider: null,
        fixtureId: replay.proposalProvenance.fixtureId,
        notes: replay.proposalProvenance.notes,
      },
      effectCapability: {
        kind: replay.effectCapability,
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

async function resolvePublicReplay(
  domainId: string,
  sourceId: string,
): Promise<PublicReplayResolution> {
  if (domainId === "network") {
    const scenario = getScenario(sourceId);
    if (!scenario || scenario.domainId !== "network" || !scenario.fixture) {
      return null;
    }
    const provenance = reviewProvenance(scenario.fixture.provenance);
    return {
      inputId: scenario.inputId,
      input: scenario.input as IncidentBundle,
      proposal: scenario.fixture.proposal,
      source:
        provenance === "captured-replay" ? "bundled-replay" : "authored-fixture",
      provenance,
      proposalProvenance: {
        model: scenario.fixture.model,
        fixtureId: scenario.fixture.fixtureId,
        notes: scenario.fixture.notes,
      },
      effectCapability: "sandbox-simulation",
    };
  }

  if (domainId === "kubernetes") {
    const {
      KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
      KUBERNETES_PUBLIC_REPLAY_SOURCES,
    } = await import("@/features/domains/kubernetes/fixtures");
    const source = KUBERNETES_PUBLIC_REPLAY_SOURCES.find(
      (candidate) => candidate.sourceId === sourceId,
    );
    if (!source) {
      return null;
    }
    if (source.kind === "unsupported") {
      return { kind: "unsupported" };
    }
    return {
      inputId: source.inputId,
      input: KUBERNETES_PUBLIC_REPLAY_SNAPSHOT,
      proposal: source.proposal,
      source: "authored-fixture",
      provenance: source.provenance,
      proposalProvenance: {
        model: null,
        fixtureId: source.sourceId,
        notes: null,
      },
      effectCapability: "sandbox-simulation",
    };
  }

  if (domainId !== "terraform") {
    return null;
  }

  const fixture = TERRAFORM_PUBLIC_REPLAY_FIXTURES.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!fixture) {
    return null;
  }
  const { deriveProposal, normalizePlan } = await import(
    "@changesafe/domain-terraform"
  );
  const input = normalizePlan(fixture.plan, {
    planId: fixture.inputId,
    context: [...fixture.context],
  });
  return {
    inputId: input.planId,
    input,
    proposal: deriveProposal(input),
    source: "authored-fixture",
    provenance: fixture.provenance,
    proposalProvenance: {
      model: null,
      fixtureId: fixture.sourceId,
      notes: null,
    },
    effectCapability: "external-diff",
  };
}

function isUnsupportedReplaySource(
  resolution: PublicReplayResolution,
): resolution is UnsupportedPublicReplaySource {
  return resolution !== null && "kind" in resolution && resolution.kind === "unsupported";
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

/**
 * An allowlisted source can still be intentionally unsupported by a domain.
 * Reject before runtime loading/evaluation so no proposal, finding, or effect
 * result is ever created for content outside the offline contract.
 */
function unsupportedSource(domainId: string): Response {
  return transportError(400, {
    code: "INPUT_INVALID",
    message:
      "The selected replay source is outside this domain's supported offline contract.",
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
