import { z } from "zod";

import {
  REVIEW_ANALYZE_API_VERSION,
  ReviewAnalyzeErrorV1Schema,
  ReviewAnalyzeRequestV1Schema,
  ReviewAnalyzeSuccessV1Schema,
} from "../domains/review-api-contract";
import type {
  ReviewTransportRequest,
  ReviewTransportResult,
} from "./useReviewController";

const ReviewAnalyzeResponseV1Schema = z.union([
  ReviewAnalyzeSuccessV1Schema,
  ReviewAnalyzeErrorV1Schema,
]);

export async function publicReplayTransport<TInput>(
  request: ReviewTransportRequest<TInput>,
): Promise<ReviewTransportResult> {
  const body = ReviewAnalyzeRequestV1Schema.parse({
    apiVersion: REVIEW_ANALYZE_API_VERSION,
    domainId: request.session.domainId,
    contractVersion: request.session.contractVersion,
    sourceId: request.sourceId,
    analysisMode: request.session.analysisMode,
  });
  const response = await fetch("/api/reviews/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: request.signal,
  });
  const wrapper = ReviewAnalyzeResponseV1Schema.parse(await response.json());

  return {
    attemptId: request.attemptId,
    payload: wrapper.result,
  };
}
