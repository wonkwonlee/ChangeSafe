import { z } from "zod";

export const REVIEW_CONTRACT_VERSION = "1.0.0" as const;

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

const ContractVersionMismatchErrorResultSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.literal("CONTRACT_VERSION_MISMATCH"),
    domainId: DomainIdSchema,
    expectedContractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    receivedContractVersion: z.string().min(1).max(64),
  }),
});

export const ReviewContractErrorResultSchema = z.union([
  UnknownDomainErrorResultSchema,
  ContractVersionMismatchErrorResultSchema,
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
