import { z } from "zod";
import {
  ChangeOpKindSchema,
  ChangeProposalSchema,
  EvidenceIdSchema,
  IdSchema,
  JsonValueSchema,
  PolicyFindingSchema,
  RiskLevelSchema,
  StatePathSchema,
  deriveRiskLevel,
} from "@changesafe/core";

/**
 * Version 2 makes `policyVersion` mandatory on every session envelope.
 *
 * This is intentionally a contract-major transition: a missing policy
 * version cannot be safely backfilled after evaluation, because receipts
 * must bind to the exact deterministic policy set that produced findings.
 * The HTTP `apiVersion: "v1"` wrapper remains stable; clients select this
 * review-contract version explicitly in its request body.
 */
export const REVIEW_CONTRACT_VERSION = "2.0.0" as const;

export const DomainIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    "domainId must be a stable lower-kebab identifier",
  );

export const DomainShapeSchema = z.enum(["simulated-state", "external-diff"]);

export const ReviewCapabilitiesSchema = z.strictObject({
  sandboxSimulation: z.boolean(),
  resourceGraph: z.boolean(),
  structuredDiff: z.boolean(),
  untrustedContext: z.boolean(),
  durableDecision: z.boolean(),
});

export const ReviewRuntimeModeSchema = z.enum(["public-replay", "self-hosted"]);

export const ReviewSourceSchema = z.enum([
  "bundled-replay",
  "authored-fixture",
  "live-model",
  "uploaded-offline-artifact",
  "read-only-collector",
]);

export const ReviewAnalysisModeSchema = z.enum(["replay", "live", "offline"]);

export const ReviewProvenanceSchema = z.enum([
  "captured-replay",
  "authored-synthetic",
  "authored-red-team",
  "live-model",
  "uploaded-offline-artifact",
  "read-only-collector",
]);

const ReviewSessionEnvelopeBaseSchema = z.strictObject({
  domainId: DomainIdSchema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  /** Exact deterministic policy set that evaluated this review. */
  policyVersion: z.string().min(1).max(32),
  domainShape: DomainShapeSchema,
  capabilities: ReviewCapabilitiesSchema,
  runtimeMode: ReviewRuntimeModeSchema,
  source: ReviewSourceSchema,
  analysisMode: ReviewAnalysisModeSchema,
  provenance: ReviewProvenanceSchema,
});

const validSourceClassifications = [
  {
    source: "bundled-replay",
    analysisMode: "replay",
    provenance: "captured-replay",
  },
  {
    source: "authored-fixture",
    analysisMode: "replay",
    provenance: "authored-synthetic",
  },
  {
    source: "authored-fixture",
    analysisMode: "replay",
    provenance: "authored-red-team",
  },
  {
    source: "live-model",
    analysisMode: "live",
    provenance: "live-model",
  },
  {
    source: "uploaded-offline-artifact",
    analysisMode: "offline",
    provenance: "uploaded-offline-artifact",
  },
  {
    source: "read-only-collector",
    analysisMode: "offline",
    provenance: "read-only-collector",
  },
] as const;

export const ReviewSessionEnvelopeSchema = ReviewSessionEnvelopeBaseSchema.superRefine(
  (session, context) => {
    if (session.domainShape === "external-diff" && session.capabilities.sandboxSimulation) {
      context.addIssue({
        code: "custom",
        message: "external-diff domains cannot advertise sandbox simulation",
        path: ["capabilities", "sandboxSimulation"],
      });
    }

    if (session.runtimeMode === "public-replay" && session.capabilities.durableDecision) {
      context.addIssue({
        code: "custom",
        message: "public replay cannot advertise durable decision support",
        path: ["capabilities", "durableDecision"],
      });
    }

    const sourceClassificationIsValid = validSourceClassifications.some(
      (classification) =>
        classification.source === session.source &&
        classification.analysisMode === session.analysisMode &&
        classification.provenance === session.provenance,
    );

    if (!sourceClassificationIsValid) {
      context.addIssue({
        code: "custom",
        message: "source, analysis mode, and provenance must describe one coherent origin",
        path: ["provenance"],
      });
    }
  },
);

const UnknownDomainErrorResultSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.literal("UNKNOWN_DOMAIN"),
    domainId: DomainIdSchema,
  }),
});

const ContractVersionMismatchErrorResultSchema = z
  .strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.literal("CONTRACT_VERSION_MISMATCH"),
      domainId: DomainIdSchema,
      expectedContractVersion: z.literal(REVIEW_CONTRACT_VERSION),
      receivedContractVersion: z.string().min(1).max(64),
    }),
  })
  .refine(
    (result) =>
      result.error.receivedContractVersion !== result.error.expectedContractVersion,
    {
      message: "received contract version must differ from the expected version",
      path: ["error", "receivedContractVersion"],
    },
  );

export const ReviewContractErrorResultSchema = z.union([
  UnknownDomainErrorResultSchema,
  ContractVersionMismatchErrorResultSchema,
]);

export const ReviewExampleDescriptorSchema = z
  .strictObject({
    domainId: DomainIdSchema,
    contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    sourceId: IdSchema,
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(1000),
    /** Non-null when this example is one of the featured case studies in
     *  docs/CASE_STUDIES.md; names which one (e.g. "Case 2"), shown as a
     *  small badge in the scenario picker. Null for every other example. */
    caseStudy: z.string().min(1).max(40).nullable().default(null),
    session: ReviewSessionEnvelopeSchema,
  })
  .superRefine((descriptor, context) => {
    if (descriptor.domainId !== descriptor.session.domainId) {
      context.addIssue({
        code: "custom",
        message: "example domain must match the review session domain",
        path: ["domainId"],
      });
    }

    if (descriptor.contractVersion !== descriptor.session.contractVersion) {
      context.addIssue({
        code: "custom",
        message: "example contract version must match the review session contract",
        path: ["contractVersion"],
      });
    }
  });

const SandboxSimulationEffectCapabilitySchema = z.strictObject({
  kind: z.literal("sandbox-simulation"),
});

const ExternalDiffEffectCapabilitySchema = z.strictObject({
  kind: z.literal("external-diff"),
});

const UnavailableEffectCapabilitySchema = z.strictObject({
  kind: z.literal("unavailable"),
  reason: z.string().min(1).max(500),
});

export const ReviewEffectCapabilitySchema = z.discriminatedUnion("kind", [
  SandboxSimulationEffectCapabilitySchema,
  ExternalDiffEffectCapabilitySchema,
  UnavailableEffectCapabilitySchema,
]);

export const ReviewProposalProvenanceSchema = z
  .strictObject({
    classification: ReviewProvenanceSchema,
    model: z.string().min(1).max(64).nullable(),
    provider: z.string().min(1).max(32).nullable(),
    fixtureId: IdSchema.nullable(),
    notes: z.string().min(1).max(1000).nullable(),
  })
  .superRefine((provenance, context) => {
    if (provenance.classification === "live-model") {
      if (provenance.model === null || provenance.provider === null) {
        context.addIssue({
          code: "custom",
          message: "live model provenance requires model and provider metadata",
          path: ["classification"],
        });
      }
      if (provenance.fixtureId !== null) {
        context.addIssue({
          code: "custom",
          message: "live model provenance cannot claim a replay fixture",
          path: ["fixtureId"],
        });
      }
      return;
    }

    if (provenance.classification === "captured-replay") {
      if (provenance.model === null || provenance.fixtureId === null) {
        context.addIssue({
          code: "custom",
          message: "captured replay provenance requires model and fixture metadata",
          path: ["classification"],
        });
      }
      return;
    }

    if (
      provenance.classification === "authored-synthetic" ||
      provenance.classification === "authored-red-team"
    ) {
      if (
        provenance.model !== null ||
        provenance.provider !== null ||
        provenance.fixtureId === null
      ) {
        context.addIssue({
          code: "custom",
          message: "authored provenance requires a fixture and cannot claim a model",
          path: ["classification"],
        });
      }
      return;
    }

    if (
      provenance.model !== null ||
      provenance.provider !== null ||
      provenance.fixtureId !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "offline input provenance cannot claim model or fixture metadata",
        path: ["classification"],
      });
    }
  });

export const ReviewAnalysisResultSchema = z
  .strictObject({
    ok: z.literal(true),
    contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    domainId: DomainIdSchema,
    session: ReviewSessionEnvelopeSchema,
    sourceId: IdSchema,
    inputId: IdSchema,
    input: JsonValueSchema,
    proposal: ChangeProposalSchema,
    findings: z.array(PolicyFindingSchema).min(1).max(64),
    riskLevel: RiskLevelSchema,
    provenance: ReviewProposalProvenanceSchema,
    effectCapability: ReviewEffectCapabilitySchema,
  })
  .superRefine((result, context) => {
    if (result.domainId !== result.session.domainId) {
      context.addIssue({
        code: "custom",
        message: "analysis domain must match the review session domain",
        path: ["domainId"],
      });
    }

    if (result.contractVersion !== result.session.contractVersion) {
      context.addIssue({
        code: "custom",
        message: "analysis contract version must match the review session contract",
        path: ["contractVersion"],
      });
    }

    if (result.provenance.classification !== result.session.provenance) {
      context.addIssue({
        code: "custom",
        message: "analysis provenance must match the review session provenance",
        path: ["provenance", "classification"],
      });
    }

    if (result.riskLevel !== deriveRiskLevel(result.findings)) {
      context.addIssue({
        code: "custom",
        message: "analysis risk must match the canonical risk derived from findings",
        path: ["riskLevel"],
      });
    }

    if (
      result.effectCapability.kind === "sandbox-simulation" &&
      (result.session.domainShape !== "simulated-state" ||
        !result.session.capabilities.sandboxSimulation)
    ) {
      context.addIssue({
        code: "custom",
        message: "sandbox simulation requires a simulation-capable state domain",
        path: ["effectCapability", "kind"],
      });
    }

    if (
      result.effectCapability.kind === "external-diff" &&
      result.session.domainShape !== "external-diff"
    ) {
      context.addIssue({
        code: "custom",
        message: "external diff effects require an external-diff domain",
        path: ["effectCapability", "kind"],
      });
    }

    if (
      result.effectCapability.kind === "unavailable" &&
      (result.session.domainShape === "external-diff" ||
        result.session.capabilities.sandboxSimulation)
    ) {
      context.addIssue({
        code: "custom",
        message: "effect unavailability is valid only when no effect mechanism exists",
        path: ["effectCapability", "kind"],
      });
    }
  });

export const ReviewTransportErrorCodeSchema = z.enum([
  "REQUEST_INVALID",
  "UNKNOWN_DOMAIN",
  "CONTRACT_VERSION_MISMATCH",
  "SOURCE_UNKNOWN",
  "INPUT_INVALID",
  "PROPOSAL_INVALID",
  "ANALYSIS_UNAVAILABLE",
  "ANALYSIS_FAILED",
  "ANALYSIS_INVALID",
  "INTERNAL",
]);

const ReviewReplayEligibleErrorCodeSchema = z.enum([
  "ANALYSIS_UNAVAILABLE",
  "ANALYSIS_FAILED",
  "ANALYSIS_INVALID",
]);

export const ReviewReplaySourceSchema = z.strictObject({
  domainId: DomainIdSchema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  sourceId: IdSchema,
});

const reviewTransportErrorFields = {
  code: ReviewTransportErrorCodeSchema,
  message: z.string().min(1).max(500),
  domainId: DomainIdSchema.nullable(),
  expectedContractVersion: z.literal(REVIEW_CONTRACT_VERSION).nullable(),
  receivedContractVersion: z.string().min(1).max(64).nullable(),
};

const ReviewReplayUnavailableErrorSchema = z.strictObject({
  ...reviewTransportErrorFields,
  replayAvailable: z.literal(false),
});

const ReviewReplayAvailableErrorSchema = z.strictObject({
  ...reviewTransportErrorFields,
  code: ReviewReplayEligibleErrorCodeSchema,
  domainId: DomainIdSchema,
  replayAvailable: z.literal(true),
  replaySource: ReviewReplaySourceSchema,
});

export const ReviewTransportErrorDetailSchema = z.discriminatedUnion(
  "replayAvailable",
  [ReviewReplayUnavailableErrorSchema, ReviewReplayAvailableErrorSchema],
);

export const ReviewTransportErrorSchema = z
  .strictObject({
    ok: z.literal(false),
    contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    error: ReviewTransportErrorDetailSchema,
  })
  .superRefine((result, context) => {
    const { error } = result;
    if (error.replayAvailable) {
      if (error.domainId !== error.replaySource.domainId) {
        context.addIssue({
          code: "custom",
          message: "replay source domain must match the validated request domain",
          path: ["error", "replaySource", "domainId"],
        });
      }

      if (
        error.expectedContractVersion !== null ||
        error.receivedContractVersion !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "replay-eligible analysis errors cannot include mismatch metadata",
          path: ["error"],
        });
      }
      return;
    }

    if (error.code === "UNKNOWN_DOMAIN") {
      if (
        error.domainId === null ||
        error.expectedContractVersion !== null ||
        error.receivedContractVersion !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "unknown domain errors require only the rejected domain id",
          path: ["error"],
        });
      }
      return;
    }

    if (error.code === "CONTRACT_VERSION_MISMATCH") {
      if (
        error.domainId === null ||
        error.expectedContractVersion === null ||
        error.receivedContractVersion === null ||
        error.receivedContractVersion === error.expectedContractVersion
      ) {
        context.addIssue({
          code: "custom",
          message: "contract mismatch errors require distinct expected and received versions",
          path: ["error"],
        });
      }
      return;
    }

    if (
      error.expectedContractVersion !== null ||
      error.receivedContractVersion !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "only contract mismatch errors include version metadata",
        path: ["error"],
      });
    }
  });

export const ReviewSummaryViewModelSchema = z.strictObject({
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1000),
  inputId: IdSchema,
  sourceId: IdSchema,
});

export const ReviewEvidenceItemViewModelSchema = z.strictObject({
  evidenceId: EvidenceIdSchema,
  label: z.string().min(1).max(160),
  detail: z.string().min(1).max(2000),
  untrusted: z.boolean(),
});

export const ReviewEvidenceViewModelSchema = z.strictObject({
  title: z.string().min(1).max(160),
  items: z.array(ReviewEvidenceItemViewModelSchema).max(5000),
});

export const ReviewChangeItemViewModelSchema = z.strictObject({
  op: ChangeOpKindSchema,
  path: StatePathSchema,
  summary: z.string().min(1).max(500),
});

export const ReviewChangeViewModelSchema = z.strictObject({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1000),
  items: z.array(ReviewChangeItemViewModelSchema).max(1000),
});

const ReviewSafetyPropertyViewModelSchema = z.strictObject({
  propertyId: IdSchema,
  satisfied: z.boolean(),
  detail: z.string().min(1).max(1000),
});

const ReviewSandboxImpactViewModelSchema = z.strictObject({
  kind: z.literal("sandbox-simulation"),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1000),
  changedResourceIds: z.array(z.string().min(1).max(256)).max(1000),
  safetyProperties: z.array(ReviewSafetyPropertyViewModelSchema).max(100),
});

const ReviewExternalDiffImpactViewModelSchema = z.strictObject({
  kind: z.literal("external-diff"),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(1000),
  changedResourceIds: z.array(z.string().min(1).max(256)).max(1000),
});

const ReviewUnavailableImpactViewModelSchema = z.strictObject({
  kind: z.literal("unavailable"),
  title: z.string().min(1).max(160),
  reason: z.string().min(1).max(500),
});

export const ReviewImpactViewModelSchema = z.discriminatedUnion("kind", [
  ReviewSandboxImpactViewModelSchema,
  ReviewExternalDiffImpactViewModelSchema,
  ReviewUnavailableImpactViewModelSchema,
]);

export type DomainId = z.infer<typeof DomainIdSchema>;
export type DomainShape = z.infer<typeof DomainShapeSchema>;
export type ReviewCapabilities = z.infer<typeof ReviewCapabilitiesSchema>;
export type ReviewRuntimeMode = z.infer<typeof ReviewRuntimeModeSchema>;
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;
export type ReviewAnalysisMode = z.infer<typeof ReviewAnalysisModeSchema>;
export type ReviewProvenance = z.infer<typeof ReviewProvenanceSchema>;
export type ReviewSessionEnvelope = z.infer<typeof ReviewSessionEnvelopeSchema>;
export type ReviewContractErrorResult = z.infer<typeof ReviewContractErrorResultSchema>;
export type ReviewExampleDescriptor = z.infer<typeof ReviewExampleDescriptorSchema>;
export type ReviewEffectCapability = z.infer<typeof ReviewEffectCapabilitySchema>;
export type ReviewProposalProvenance = z.infer<typeof ReviewProposalProvenanceSchema>;
export type ReviewAnalysisResult = z.infer<typeof ReviewAnalysisResultSchema>;
export type ReviewTransportErrorCode = z.infer<typeof ReviewTransportErrorCodeSchema>;
export type ReviewReplaySource = z.infer<typeof ReviewReplaySourceSchema>;
export type ReviewTransportErrorDetail = z.infer<
  typeof ReviewTransportErrorDetailSchema
>;
export type ReviewTransportError = z.infer<typeof ReviewTransportErrorSchema>;
export type ReviewSummaryViewModel = z.infer<typeof ReviewSummaryViewModelSchema>;
export type ReviewEvidenceItemViewModel = z.infer<
  typeof ReviewEvidenceItemViewModelSchema
>;
export type ReviewEvidenceViewModel = z.infer<typeof ReviewEvidenceViewModelSchema>;
export type ReviewChangeItemViewModel = z.infer<typeof ReviewChangeItemViewModelSchema>;
export type ReviewChangeViewModel = z.infer<typeof ReviewChangeViewModelSchema>;
export type ReviewImpactViewModel = z.infer<typeof ReviewImpactViewModelSchema>;
