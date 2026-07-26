import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import { DomainError, isDomainError } from "@changesafe/core";
import type { Ledger } from "@changesafe/ledger";

import { DecisionService, type DecisionRequest } from "./decisions";
import { SERVER_DOMAIN_IDS } from "./domains";
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

export interface DecisionServerOptions {
  ledger: Ledger;
  verifier: OidcVerifier;
  decisions: DecisionService;
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

  if (route === "GET /ledger/verify") {
    const verdict = await options.ledger.verifyChain();
    send(response, verdict.ok ? 200 : 409, verdict);
    return;
  }

  send(response, 404, {
    error: { code: "REQUEST_INVALID", message: `No route for ${route}.` },
  });
}
