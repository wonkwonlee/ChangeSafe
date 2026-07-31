import { z } from "zod";
import {
  ApproverSchema,
  IdSchema,
  PolicyFindingSchema,
  RiskLevelSchema,
  Sha256HexSchema,
  SignedReceiptSchema,
  TimestampSchema,
} from "@changesafe/core";

import {
  DurableReviewDomainIdSchema,
  DurableReviewIntakeSchema,
  DurableReviewResolutionSchema,
  PendingDurableReviewRecordSchema,
  ReceiptProofSchema,
  type DurableReviewIntake,
  type ReceiptProof,
} from "./durable-review-contract";

// The durable review contract owns the set of domains that can be queued.
// Restating it here would let a new durable domain be accepted by the contract
// and silently refused by this generic transport.
const ReviewSummarySchema = z.strictObject({
  seq: z.number().int().positive(),
  reviewId: IdSchema,
  createdAtUtc: TimestampSchema,
  domainId: DurableReviewDomainIdSchema,
  sourceId: IdSchema,
  inputId: IdSchema,
});

const ReviewEntrySchema = ReviewSummarySchema.extend({
  record: PendingDurableReviewRecordSchema,
});

/**
 * Server-recomputed policy evidence for one pending review.
 *
 * This is a sibling of the stored record, never a field inside it: findings
 * and risk are derived at response time by the server's own policy
 * evaluation. `PendingDurableReviewRecordSchema` is strict and carries no
 * findings, so a stored or client-supplied verdict cannot arrive by this
 * route and be mistaken for a recomputed one.
 */
const ReviewProjectionSchema = z.strictObject({
  policyVersion: z.string().min(1).max(64),
  findings: z.array(PolicyFindingSchema),
  riskLevel: RiskLevelSchema,
  approvable: z.boolean(),
});

const ReviewDetailSchema = z.strictObject({
  review: ReviewEntrySchema,
  projection: ReviewProjectionSchema,
});

const ResolutionEntrySchema = z.strictObject({
  seq: z.number().int().positive(),
  reviewId: IdSchema,
  resolvedAtUtc: TimestampSchema,
  receiptId: IdSchema,
  receiptSha256: Sha256HexSchema,
  claimBinding: z.enum(["verified-claim", "verified-legacy-migration"]),
  resolution: DurableReviewResolutionSchema,
});

const DecisionResultSchema = z.strictObject({
  receiptId: IdSchema,
  decision: z.enum(["approved", "rejected"]),
  riskLevel: RiskLevelSchema,
  approver: ApproverSchema,
  ledgerSeq: z.number().int().positive(),
  chainSha256: Sha256HexSchema,
  record: SignedReceiptSchema,
  resolution: ResolutionEntrySchema,
});

const ErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  }),
});

export type SelfHostedReviewSummary = z.infer<typeof ReviewSummarySchema>;
export type SelfHostedReviewEntry = z.infer<typeof ReviewEntrySchema>;
export type SelfHostedReviewProjection = z.infer<typeof ReviewProjectionSchema>;
export type SelfHostedReviewDetail = z.infer<typeof ReviewDetailSchema>;
export type SelfHostedDecisionResult = z.infer<typeof DecisionResultSchema>;

export class SelfHostedReviewTransportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SelfHostedReviewTransportError";
    this.status = status;
    this.code = code;
  }
}

export interface SelfHostedReviewTransport {
  list(): Promise<readonly SelfHostedReviewSummary[]>;
  /** Returns the stored record plus the server's response-time recomputation. */
  get(reviewId: string): Promise<SelfHostedReviewDetail>;
  create(reviewId: string, intake: DurableReviewIntake): Promise<SelfHostedReviewEntry>;
  decide(
    reviewId: string,
    decision: "approve" | "reject",
  ): Promise<SelfHostedDecisionResult>;
  getReceiptProof(
    reviewId: string,
  ): Promise<{ readonly status: "pending" } | { readonly status: "resolved"; readonly proof: ReceiptProof }>;
}

function isExplicitLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const parsed = z.string().url().parse(rawBaseUrl);
  const url = new URL(parsed);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isExplicitLoopback(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The public self-hosted gateway URL must use HTTPS. Cleartext HTTP is allowed only for explicit loopback development, and credentials, query, or fragment are forbidden.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SelfHostedReviewTransportError(
      response.status,
      "INVALID_RESPONSE",
      "The self-hosted review service returned an unreadable response.",
    );
  }
}

export function createSelfHostedReviewTransport(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): SelfHostedReviewTransport {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
    if (!response.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(await readJson(response));
      throw new SelfHostedReviewTransportError(
        response.status,
        parsed.success ? parsed.data.error.code : "REQUEST_FAILED",
        parsed.success
          ? parsed.data.error.message
          : "The self-hosted review request failed safely.",
      );
    }
    return response;
  }

  return {
    async list() {
      const body = z
        .strictObject({ reviews: z.array(ReviewSummarySchema) })
        .parse(await readJson(await request("/reviews")));
      return body.reviews;
    },
    async get(reviewId) {
      return ReviewDetailSchema.parse(
        await readJson(await request(`/reviews/${IdSchema.parse(reviewId)}`)),
      );
    },
    async create(reviewId, intake) {
      const body = z
        .strictObject({ review: ReviewEntrySchema })
        .parse(
          await readJson(
            await request("/reviews", {
              method: "POST",
              body: JSON.stringify({
                reviewId: IdSchema.parse(reviewId),
                intake: DurableReviewIntakeSchema.parse(intake),
              }),
            }),
          ),
        );
      return body.review;
    },
    async decide(reviewId, decision) {
      return DecisionResultSchema.parse(
        await readJson(
          await request(`/reviews/${IdSchema.parse(reviewId)}/decisions`, {
            method: "POST",
            body: JSON.stringify({ decision }),
          }),
        ),
      );
    },
    async getReceiptProof(reviewId) {
      try {
        const body = z
          .strictObject({ proof: ReceiptProofSchema })
          .parse(
            await readJson(
              await request(`/reviews/${IdSchema.parse(reviewId)}/receipt-proof`),
            ),
          );
        return { status: "resolved", proof: body.proof };
      } catch (error) {
        if (
          error instanceof SelfHostedReviewTransportError &&
          error.status === 409 &&
          error.code === "ILLEGAL_TRANSITION"
        ) {
          return { status: "pending" };
        }
        throw error;
      }
    },
  };
}
