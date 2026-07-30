import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import { DomainError, IdSchema, TimestampSchema, isDomainError } from "@changesafe/core";
import { NetworkChangeProposalSchema } from "@changesafe/domain-network";
import { TerraformInputSchema } from "@changesafe/domain-terraform";
import type { Ledger } from "@changesafe/ledger";

import {
  DurableReviewIntakeSchema,
  DurableReviewOwnerSchema,
  type DurableReviewIntake,
} from "../../../features/reviews/durable-review-contract";
import { REVIEW_CONTRACT_VERSION } from "../../../features/domains/review-contract";
import { DecisionService, type DecisionRequest } from "./decisions";
import { DurableReviewStore, type DurableReviewStoreEntry } from "./durable-review-store";
import { SERVER_DOMAIN_IDS, resolveServerDomain } from "./domains";
import { AuthenticationError, AuthorizationError, OidcVerifier, bearerToken } from "./oidc";

/** Plans and bundles are large; anything past this is not our client. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Distinct from a schema failure: the body was never read, so telling the
 * caller it did not match a shape would be a guess about content nobody
 * looked at.
 */
class PayloadTooLargeError extends DomainError {
  constructor() {
    super(
      "REQUEST_INVALID",
      `The request body exceeds the ${Math.round(MAX_BODY_BYTES / 1024)} KiB limit.`,
    );
    this.name = "PayloadTooLargeError";
  }
}

/** Malformed JSON is the caller's mistake, and a 500 would blame the server. */
class MalformedJsonError extends DomainError {
  constructor() {
    super("REQUEST_INVALID", "The request body is not valid JSON.");
    this.name = "MalformedJsonError";
  }
}

const DecisionBodySchema = z.strictObject({
  domain: z.enum(SERVER_DOMAIN_IDS as [string, ...string[]]),
  sourceId: z.string().min(2).max(64),
  input: z.unknown(),
  proposal: z.unknown().optional(),
  decision: z.enum(["approve", "reject"]),
});

/**
 * The client may submit only an offline read-only intake. Session authority,
 * policy metadata, workflow state, findings, risk, and any receipt are all
 * server-owned concerns and are deliberately absent from this body.
 */
const ReviewIntakeBodySchema = z.strictObject({
  reviewId: IdSchema,
  intake: DurableReviewIntakeSchema,
});

/**
 * The stored pending record owns domain, input, and proposal identity. A human
 * submits only the final approve/reject intent; Kubernetes or any caller
 * finding/risk/receipt field is therefore rejected by this strict envelope.
 */
const ReviewDecisionBodySchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
});

export interface DecisionServerOptions {
  ledger: Ledger;
  verifier: OidcVerifier;
  decisions: DecisionService;
  /** Optional during rolling upgrades; /reviews does not exist without it. */
  reviews?: DurableReviewStore;
  /** Injectable only for deterministic server tests; client timestamps are never queue timestamps. */
  now?: () => string;
}

function pendingReviewSession(intake: DurableReviewIntake) {
  const network = intake.domainId === "network";
  return {
    domainId: intake.domainId,
    contractVersion: REVIEW_CONTRACT_VERSION,
    policyVersion: resolveServerDomain(intake.domainId).adapter.policyVersion,
    domainShape: network ? "simulated-state" : "external-diff",
    capabilities: {
      sandboxSimulation: network,
      resourceGraph: true,
      structuredDiff: true,
      untrustedContext: true,
      durableDecision: true,
    },
    runtimeMode: "self-hosted",
    source: "uploaded-offline-artifact",
    analysisMode: "offline",
    provenance: "uploaded-offline-artifact",
  } as const;
}

function normalizeUploadedIntake(intake: DurableReviewIntake): DurableReviewIntake {
  // The public HTTP endpoint receives an uploaded artifact. A caller must not
  // turn that upload into evidence of a live collector merely by setting a
  // provenance enum. Artifact observation time remains explicitly client
  // claimed and is never confused with the server queue timestamp.
  return {
    ...intake,
    source: { ...intake.source, origin: "uploaded-offline-artifact" },
  };
}

function durableReviewOwner(identity: { issuer: string; subject: string }) {
  return DurableReviewOwnerSchema.parse({
    tenantId: identity.issuer,
    issuer: identity.issuer,
    subject: identity.subject,
    scope: "self-hosted-review",
  });
}

function serverNow(options: DecisionServerOptions): string {
  return TimestampSchema.parse(options.now?.() ?? new Date().toISOString());
}

/**
 * The intake contract proves content integrity; the server also proves that
 * the caller did not attach that content to an invented input identity.  This
 * deliberately stops before policy evaluation: queueing is not a decision.
 */
function assertIntakeInputIdentity(intake: DurableReviewIntake): void {
  const inputId =
    intake.domainId === "terraform"
      ? TerraformInputSchema.parse(intake.input.content).planId
      : resolveServerDomain(intake.domainId).parseInput(intake.input.content).inputId;
  if (inputId !== intake.input.inputId) {
    throw new DomainError(
      "REQUEST_INVALID",
      "The durable intake inputId does not match the validated domain input.",
    );
  }
  if (intake.domainId === "network") {
    const proposal = NetworkChangeProposalSchema.parse(intake.proposal?.content);
    if (proposal.proposalId !== intake.proposal?.proposalId) {
      throw new DomainError(
        "REQUEST_INVALID",
        "The durable intake proposalId does not match the validated Network proposal.",
      );
    }
  }
}

function reviewSummary(entry: DurableReviewStoreEntry) {
  return {
    seq: entry.seq,
    reviewId: entry.reviewId,
    createdAtUtc: entry.createdAtUtc,
    domainId: entry.domainId,
    sourceId: entry.sourceId,
    inputId: entry.inputId,
  };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    // This API returns decisions, never markup; nothing here should ever be
    // interpreted as a document by a browser.
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  response.end(payload);
}

/**
 * Map a failure to a status a caller can act on.
 *
 * Only typed domain errors reach a client verbatim — their messages are
 * written for people and carry no internals. Anything else becomes a plain
 * 500, because an unexpected error's message is not known to be safe.
 */
function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof AuthenticationError) {
    response.setHeader("www-authenticate", "Bearer");
    send(response, 401, { error: { code: "UNAUTHENTICATED", message: error.userMessage } });
    return;
  }
  // Authenticated, and still not allowed to do this. A fresh token does not
  // help, so it must not read as an authentication problem.
  if (error instanceof AuthorizationError) {
    send(response, 403, { error: { code: "FORBIDDEN", message: error.userMessage } });
    return;
  }
  if (error instanceof PayloadTooLargeError) {
    send(response, 413, { error: { code: "REQUEST_INVALID", message: error.userMessage } });
    return;
  }
  if (isDomainError(error)) {
    const status =
      error.code === "ILLEGAL_TRANSITION" ? 409
      : error.code === "EVIDENCE_UNKNOWN" || error.code === "SCHEMA_VALIDATION" ? 422
      : error.code === "REQUEST_INVALID" ? 400
      : 500;
    send(response, status, { error: { code: error.code, message: error.userMessage } });
    return;
  }
  if (error instanceof z.ZodError) {
    send(response, 422, {
      error: {
        code: "SCHEMA_VALIDATION",
        message: "The request body did not match the expected shape.",
      },
    });
    return;
  }
  send(response, 500, {
    error: { code: "INTERNAL", message: "The request failed unexpectedly." },
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new MalformedJsonError();
  }
}

/**
 * The self-hosted decision API.
 *
 * Deliberately small and deliberately unable to do anything but decide and
 * record. There is no endpoint that executes a change, and none that writes
 * to the ledger except by making a decision — so the audit trail cannot be
 * edited through the same door it is written through.
 */
export function createDecisionServer(options: DecisionServerOptions): Server {
  return createServer((request, response) => {
    void handle(request, response, options).catch((error: unknown) => {
      sendError(response, error);
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: DecisionServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const route = `${request.method ?? "GET"} ${url.pathname}`;

  // Liveness carries no data and needs no identity.
  if (route === "GET /health") {
    send(response, 200, { status: "ok", entries: options.ledger.count() });
    return;
  }

  // Everything below this line requires an authenticated approver.
  const identity = await options.verifier.verify(bearerToken(request.headers.authorization));
  const approver = {
    subject: identity.subject,
    issuer: identity.issuer,
    email: identity.email,
  };

  if (route === "POST /decisions") {
    const body = DecisionBodySchema.parse(await readBody(request));
    const outcome = await options.decisions.decide(body as DecisionRequest, approver);
    send(response, 201, {
      receiptId: outcome.receipt.receiptId,
      decision: outcome.receipt.decision,
      riskLevel: outcome.receipt.riskLevel,
      approver: outcome.receipt.approver,
      ledgerSeq: outcome.ledgerSeq,
      chainSha256: outcome.chainSha256,
      record: outcome.record,
    });
    return;
  }

  if (route === "POST /reviews") {
    if (!options.reviews) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
      });
      return;
    }
    const body = ReviewIntakeBodySchema.parse(await readBody(request));
    const intake = normalizeUploadedIntake(body.intake);
    assertIntakeInputIdentity(intake);
    // `appendPending` recomputes the canonical content hash and revalidates
    // the domain schema before its immutable database append.  The explicit
    // server construction here prevents a client from claiming public or
    // legacy authority, findings/risk, or a receipt that does not exist yet.
    const review = await options.reviews.appendPending({
      recordVersion: "2",
      reviewId: body.reviewId,
      createdAtUtc: serverNow(options),
      owner: durableReviewOwner(identity),
      session: pendingReviewSession(intake),
      intake,
      storage: { kind: "append-only-review-store" },
    });
    send(response, 201, { review });
    return;
  }

  const reviewDecisionMatch =
    request.method === "POST"
      ? /^\/reviews\/([^/]+)\/decisions$/.exec(url.pathname)
      : null;
  if (reviewDecisionMatch) {
    if (!options.reviews) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
      });
      return;
    }
    const reviewId = IdSchema.parse(reviewDecisionMatch[1]);
    const owner = durableReviewOwner(identity);
    // Owner filtering deliberately precedes body parsing and returns the same
    // response as an absent id, so another principal cannot use validation
    // differences to probe the queue.
    if (!options.reviews.get(reviewId, owner)) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: "The requested review was not found." },
      });
      return;
    }
    const body = ReviewDecisionBodySchema.parse(await readBody(request));
    const decided = await options.reviews.resolvePending(
      reviewId,
      owner,
      {
        decision: body.decision,
        claimedAtUtc: serverNow(options),
        approverEmail: approver.email,
      },
      async (pending, claim) => {
        // Both domain choices come from the validated immutable pending
        // record. Network re-parses its hash-bound proposal artifact;
        // Terraform derives its proposal from the stored plan.
        const outcome = await options.decisions.decideSigned(
          {
            domain: pending.intake.domainId,
            sourceId: pending.intake.source.sourceId,
            input: pending.intake.input.content,
            ...(pending.intake.proposal
              ? { proposal: pending.intake.proposal.content }
              : {}),
            decision: body.decision,
          },
          {
            subject: claim.owner.subject,
            issuer: claim.owner.issuer,
            email: claim.approverEmail,
          },
          {
            expectedPolicyVersion: pending.session.policyVersion,
            receiptId: claim.receiptId,
            receiptCreatedAtUtc: claim.receiptCreatedAtUtc,
            receiptSignedAtUtc: claim.receiptSignedAtUtc,
          },
        );
        return {
          outcome,
          resolution: {
            resolutionVersion: "1",
            reviewId,
            resolvedAtUtc: serverNow(options),
            receipt: {
              receiptId: outcome.receipt.receiptId,
              sourceId: outcome.receipt.sourceId,
              inputId: outcome.receipt.inputId,
              inputSha256: outcome.receipt.inputSha256,
              proposalId: outcome.receipt.proposalId,
              proposalSha256: outcome.receipt.proposalSha256,
              policyVersion: outcome.receipt.policyVersion,
              receiptSha256: outcome.receipt.receiptSha256,
            },
          },
        };
      },
    );
    send(response, 201, {
      receiptId: decided.outcome.receipt.receiptId,
      decision: decided.outcome.receipt.decision,
      riskLevel: decided.outcome.receipt.riskLevel,
      approver: decided.outcome.receipt.approver,
      ledgerSeq: decided.outcome.ledgerSeq,
      chainSha256: decided.outcome.chainSha256,
      record: decided.outcome.record,
      resolution: decided.resolution,
    });
    return;
  }

  if (route === "GET /decisions") {
    // A query string is caller input: "limit=abc" is Number -> NaN, which the
    // ledger would otherwise carry into SQL. Absent and unreadable both mean
    // unspecified — note that `Number(null)` is 0, not NaN, so the absent case
    // has to be handled before the conversion rather than after it.
    const requestedLimit = url.searchParams.get("limit");
    const parsedLimit = requestedLimit === null ? Number.NaN : Number(requestedLimit);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    send(response, 200, {
      entries: options.ledger
        .list({
          limit,
          sourceId: url.searchParams.get("sourceId") ?? undefined,
          decision: url.searchParams.get("decision") ?? undefined,
        })
        .map((entry) => ({
          seq: entry.seq,
          receiptId: entry.receiptId,
          createdAtUtc: entry.createdAtUtc,
          decision: entry.decision,
          riskLevel: entry.riskLevel,
          sourceId: entry.sourceId,
          signatureKeyId: entry.signatureKeyId,
        })),
    });
    return;
  }

  if (route === "GET /reviews") {
    if (!options.reviews) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
      });
      return;
    }
    const requestedLimit = url.searchParams.get("limit");
    const parsedLimit = requestedLimit === null ? Number.NaN : Number(requestedLimit);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const requestedDomainId = url.searchParams.get("domainId");
    // Parse here, rather than handing arbitrary string values to SQLite's
    // filter layer. Kubernetes is intentionally unsupported for durable
    // self-hosted intake at this stage.
    const reviews = options.reviews.list({
      limit,
      ...(requestedDomainId === null
        ? {}
        : { domainId: z.enum(["network", "terraform"]).parse(requestedDomainId) }),
      sourceId: url.searchParams.get("sourceId") ?? undefined,
    }, durableReviewOwner(identity));
    send(response, 200, { reviews: reviews.map(reviewSummary) });
    return;
  }

  const reviewMatch = request.method === "GET" ? /^\/reviews\/([^/]+)$/.exec(url.pathname) : null;
  if (reviewMatch) {
    if (!options.reviews) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
      });
      return;
    }
    const reviewId = IdSchema.parse(reviewMatch[1]);
    const review = options.reviews.get(reviewId, durableReviewOwner(identity));
    if (!review) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: "The requested review was not found." },
      });
      return;
    }
    send(response, 200, { review });
    return;
  }

  if (route === "GET /ledger/verify") {
    const verdict = await options.ledger.verifyChain();
    send(response, verdict.ok ? 200 : 409, verdict);
    return;
  }

  send(response, 404, {
    error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
  });
}
