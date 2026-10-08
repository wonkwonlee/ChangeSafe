import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import { AuthorizationGrantSchema, DomainError, IdSchema, TimestampSchema, canonicalize, isDomainError } from "@changesafe/core";
import { NetworkChangeProposalSchema } from "@changesafe/domain-network";
import { TerraformInputSchema } from "@changesafe/domain-terraform";
import type { Ledger } from "@changesafe/ledger";

import {
  DurableReviewIntakeSchema,
  DurableReviewOwnerSchema,
  type DurableReviewIntake,
} from "../../../features/reviews/durable-review-contract";
import { REVIEW_CONTRACT_VERSION } from "../../../features/domains/review-contract";
import { deriveReviewedGrantBinding, GrantPreferencesSchema } from "./grant-binding";
import { DecisionService, type DecisionRequest } from "./decisions";
import { DurableReviewStore, type DurableReviewStoreEntry } from "./durable-review-store";
import { SERVER_DOMAIN_IDS, resolveServerDomain } from "./domains";
import { AuthenticationError, AuthorizationError, OidcVerifier, bearerToken } from "./oidc";
import { buildReceiptProof } from "./receipt-proof";

/** Plans and bundles are large; anything past this is not our client. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Intake includes both raw collected state and the candidate manifest.
const MAX_REVIEW_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The pre-ledger expiresAtUtc check only guarantees a grant's window is
 * non-empty at the instant it's captured — it says nothing about whether
 * that window survives long enough to actually be usable. `resolvePending`
 * (ledger append included) still runs after this check, and the response
 * still has to reach the caller after that; an expiresAtUtc set only
 * moments after `grantIssuedAtUtc` can pass validation and still arrive
 * already-expired, since the enforcer checks the real clock, not the
 * grant's backdated `issuedAtUtc`. This margin is a deliberately generous,
 * round number for that round-trip, not a measured bound.
 */
const MIN_GRANT_LIFETIME_MS = 5000;

/**
 * Distinct from a schema failure: the body was never read, so telling the
 * caller it did not match a shape would be a guess about content nobody
 * looked at.
 */
class PayloadTooLargeError extends DomainError {
  constructor(limit: number) {
    super(
      "REQUEST_INVALID",
      `The request body exceeds the ${Math.round(limit / 1024)} KiB limit.`,
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
const GrantRequestSchema = GrantPreferencesSchema;

const ReviewDecisionBodySchema = z
  .strictObject({
    decision: z.enum(["approve", "reject"]),
    grant: GrantRequestSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.decision === "reject" && body.grant) {
      ctx.addIssue({
        code: "custom",
        path: ["grant"],
        message: "a rejected decision cannot carry grant parameters",
      });
    }
  });

export interface DecisionServerOptions {
  ledger: Ledger;
  verifier: OidcVerifier;
  decisions: DecisionService;
  /** Optional during rolling upgrades; /reviews does not exist without it. */
  reviews?: DurableReviewStore;
  /** Operator-controlled OOB keys by fingerprint; never populated from a receipt or browser. */
  trustedReceiptPublicKeys?: ReadonlyMap<string, CryptoKey>;
  /** Injectable only for deterministic server tests; client timestamps are never queue timestamps. */
  now?: () => string;
}

function pendingReviewSession(intake: DurableReviewIntake) {
  const simulated = intake.domainId !== "terraform";
  return {
    domainId: intake.domainId,
    contractVersion: REVIEW_CONTRACT_VERSION,
    policyVersion: resolveServerDomain(intake.domainId).adapter.policyVersion,
    domainShape: simulated ? "simulated-state" : "external-diff",
    capabilities: {
      sandboxSimulation: simulated,
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

/**
 * The immutable pending record owns domain, input, and proposal identity.
 * Both the read projection and the decision path derive their request from it
 * so a client can never influence what the server evaluates.
 */
function pendingReviewRequest(
  pending: DurableReviewStoreEntry["record"],
): Omit<DecisionRequest, "decision"> {
  return {
    domain: pending.intake.domainId,
    sourceId: pending.intake.source.sourceId,
    input: pending.intake.input.content,
    ...(pending.intake.proposal ? { proposal: pending.intake.proposal.content } : {}),
  };
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

async function readBody(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new PayloadTooLargeError(limit);
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
    const body = ReviewIntakeBodySchema.parse(await readBody(request, MAX_REVIEW_BODY_BYTES));
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
    const pendingEntry = options.reviews.get(reviewId, owner);
    if (!pendingEntry) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: "The requested review was not found." },
      });
      return;
    }
    const body = ReviewDecisionBodySchema.parse(await readBody(request));
    const scope = canonicalize({ owner, reviewId });
    const existingIntent = options.reviews.grants.intent(scope);
    const grantIssuedAtUtc = existingIntent?.issuedAtUtc ?? serverNow(options);
    const requestForDecision = { ...pendingReviewRequest(pendingEntry.record), decision: body.decision };
    const existingResolution = options.reviews.getResolution(reviewId, owner);
    if (!existingResolution) {
      options.decisions.preflightSigned(requestForDecision, pendingEntry.record.session.policyVersion);
      if (body.grant) {
        if (Date.parse(body.grant.expiresAtUtc) - Date.parse(grantIssuedAtUtc) < MIN_GRANT_LIFETIME_MS) {
          throw new DomainError("REQUEST_INVALID", "Grant lifetime must leave at least 5000ms for issuance.");
        }
        const binding = await deriveReviewedGrantBinding(requestForDecision);
        AuthorizationGrantSchema.parse({
          ...binding, ...body.grant, grantId: "grant-preflight", receiptId: "receipt-preflight",
          policyVersion: pendingEntry.record.session.policyVersion, issuedAtUtc: grantIssuedAtUtc,
        });
      }
    } else if (!existingIntent || !body.grant) {
      throw new DomainError("ILLEGAL_TRANSITION", "Review already has an immutable resolution.");
    }
    const intent = options.reviews.grants.claim(scope, {
      decision: body.decision, grant: body.grant ?? null, issuedAtUtc: grantIssuedAtUtc,
    });
    const durableDecisionRequest = (pending: DurableReviewStoreEntry["record"]): DecisionRequest => ({
      ...pendingReviewRequest(pending),
      decision: body.decision,
    });
    const decided = existingResolution
      ? { outcome: await options.decisions.readSignedOutcome(existingResolution.resolution.receipt.receiptId), resolution: existingResolution }
      : await options.reviews.resolvePending(
      reviewId,
      owner,
      {
        decision: body.decision,
        claimedAtUtc: serverNow(options),
        approverEmail: approver.email,
      },
      (pending) => {
        options.decisions.preflightSigned(
          durableDecisionRequest(pending),
          pending.session.policyVersion,
        );
      },
      async (pending, claim) => {
        // Both domain choices come from the validated immutable pending
        // record. Network re-parses its hash-bound proposal artifact;
        // Terraform derives its proposal from the stored plan.
        const outcome = await options.decisions.decideSigned(
          durableDecisionRequest(pending),
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
            resolvedAtUtc: claim.claimedAtUtc,
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
    // The immutable intent survives every crash window. Issuance is idempotent
    // by receipt identity; persist the signed result before exposing it.
    let grant = options.reviews.grants.grant(scope);
    if (intent.grant) {
      if (!grant) {
        grant = options.reviews.grants.record(scope,
          await options.decisions.issueGrant(decided.outcome.receipt,
            { ...intent.grant, issuedAtUtc: intent.issuedAtUtc }, requestForDecision));
      }
      await options.decisions.validateStoredGrant(grant, decided.outcome.receipt, requestForDecision, intent.grant);
    }

    send(response, 201, {
      receiptId: decided.outcome.receipt.receiptId,
      decision: decided.outcome.receipt.decision,
      riskLevel: decided.outcome.receipt.riskLevel,
      approver: decided.outcome.receipt.approver,
      ledgerSeq: decided.outcome.ledgerSeq,
      chainSha256: decided.outcome.chainSha256,
      record: decided.outcome.record,
      resolution: decided.resolution,
      ...(grant ? { grant } : {}),
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
        : { domainId: z.enum(["network", "terraform", "kubernetes"]).parse(requestedDomainId) }),
      sourceId: url.searchParams.get("sourceId") ?? undefined,
    }, durableReviewOwner(identity));
    send(response, 200, { reviews: reviews.map(reviewSummary) });
    return;
  }

  const receiptProofMatch =
    request.method === "GET"
      ? /^\/reviews\/([^/]+)\/receipt-proof$/.exec(url.pathname)
      : null;
  if (receiptProofMatch) {
    if (!options.reviews) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
      });
      return;
    }
    const reviewId = IdSchema.parse(receiptProofMatch[1]);
    const owner = durableReviewOwner(identity);
    // Resolve owner visibility before consulting either the resolution or
    // ledger so another principal gets the same 404 as an absent review.
    if (!options.reviews.get(reviewId, owner)) {
      send(response, 404, {
        error: { code: "REQUEST_INVALID", message: "The requested review was not found." },
      });
      return;
    }
    const resolution = options.reviews.getResolution(reviewId, owner);
    if (!resolution) {
      send(response, 409, {
        error: {
          code: "ILLEGAL_TRANSITION",
          message: "The requested review does not have an immutable resolution.",
        },
      });
      return;
    }
    const proof = await buildReceiptProof(resolution.resolution, options.ledger, {
      checkedAtUtc: serverNow(options),
      ...(options.trustedReceiptPublicKeys
        ? { trustedPublicKeys: options.trustedReceiptPublicKeys }
        : {}),
    });
    send(response, 200, { proof });
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
    // Recomputed on every read, never stored: an approver must be able to see
    // what the gate found before deciding, and a findings value persisted
    // beside the artifact could only go stale or be tampered with.
    const projection = options.decisions.project(
      pendingReviewRequest(review.record),
    );
    send(response, 200, { review, projection });
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
