import { z } from "zod";
import { IdSchema } from "@changesafe/core";

import {
  REVIEW_CONTRACT_VERSION,
  ReviewAnalysisModeSchema,
  ReviewAnalysisResultSchema,
  ReviewTransportErrorSchema,
} from "./review-contract";

/**
 * Transport-envelope version. It is independent from REVIEW_CONTRACT_VERSION:
 * the V1 endpoint carries an explicit review-contract version in its body.
 */
export const REVIEW_ANALYZE_API_VERSION = "v1" as const;

export const ReviewAnalyzeDomainIdV1Schema = z.enum([
  "network",
  "terraform",
  "kubernetes",
]);

export const ReviewAnalyzeRequestV1Schema = z.strictObject({
  apiVersion: z.literal(REVIEW_ANALYZE_API_VERSION),
  domainId: ReviewAnalyzeDomainIdV1Schema,
  contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
  sourceId: IdSchema,
  analysisMode: ReviewAnalysisModeSchema,
});

export const ReviewAnalyzeSuccessV1Schema = z.strictObject({
  apiVersion: z.literal(REVIEW_ANALYZE_API_VERSION),
  result: ReviewAnalysisResultSchema,
});

export const ReviewAnalyzeErrorV1Schema = z.strictObject({
  apiVersion: z.literal(REVIEW_ANALYZE_API_VERSION),
  result: ReviewTransportErrorSchema,
});

export type ReviewAnalyzeDomainIdV1 = z.infer<
  typeof ReviewAnalyzeDomainIdV1Schema
>;
export type ReviewAnalyzeRequestV1 = z.infer<
  typeof ReviewAnalyzeRequestV1Schema
>;
export type ReviewAnalyzeSuccessV1 = z.infer<
  typeof ReviewAnalyzeSuccessV1Schema
>;
export type ReviewAnalyzeErrorV1 = z.infer<
  typeof ReviewAnalyzeErrorV1Schema
>;
