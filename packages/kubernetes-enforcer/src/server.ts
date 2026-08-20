import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { SignedGrant } from "@changesafe/core";
import { SignedGrantSchema } from "@changesafe/core";

import {
  AdmissionReviewRequestSchema,
  buildAdmissionReviewResponse,
  type AdmissionReviewRequest,
} from "./admission-review";
import { verifyGrantAgainstAdmission } from "./verify";

const MAX_BODY_BYTES = 1024 * 1024;

export interface EnforcerServerOptions {
  trustedPublicKey: CryptoKey;
  now: () => Date;
  /**
   * Resolve the expected domain resource id for this admission request
   * (via @changesafe/domain-kubernetes's resourceIdOf) so verify.ts can
   * check it against the grant's `resource` field.
   */
  resolveExpectedResource: (object: unknown) => string;
  expectedPolicyVersion?: string;
  /**
   * How the grant physically arrives with the request. Task 10 resolved
   * this empirically: `kubectl apply` has no way to attach an out-of-band
   * header, but the Kubernetes API server always forwards the full admitted
   * object (including annotations) inside the AdmissionReview body — so the
   * real mechanism is an annotation on the object itself, read from the
   * already-parsed `review`. The raw `request` is still passed through for
   * test doubles that read headers (see server.test.ts); production
   * `readGrant` implementations should read `review.request.object`.
   */
  readGrant: (request: IncomingMessage, review: AdmissionReviewRequest) => unknown | null;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

/**
 * The request listener alone, reusable by any HTTP(S) server — not just
 * node:http's. `createEnforcerServer` uses this for tests and the plain-HTTP
 * case; the deployed enforcer (src/main.ts) wraps it in node:https for real
 * TLS termination, since ValidatingWebhookConfiguration requires HTTPS.
 */
export function createEnforcerRequestListener(
  options: EnforcerServerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void handle(request, response, options).catch(() => {
      send(response, 500, { error: "internal error" });
    });
  };
}

export function createEnforcerServer(options: EnforcerServerOptions): Server {
  return createServer(createEnforcerRequestListener(options));
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: EnforcerServerOptions,
): Promise<void> {
  // Kubernetes' admission webhook client appends its own query string (e.g.
  // `?timeout=10s`) to the clientConfig path, so the real path must be
  // compared without it — a real kind cluster exposed this; server.test.ts
  // never did because it requests the bare path directly.
  const path = request.url?.split("?", 1)[0];
  if (request.method !== "POST" || path !== "/validate") {
    send(response, 404, { error: "not found" });
    return;
  }

  const review = AdmissionReviewRequestSchema.parse(await readBody(request));
  const rawGrant = options.readGrant(request, review);

  if (rawGrant === null) {
    send(
      response,
      200,
      buildAdmissionReviewResponse(review.request.uid, {
        allowed: false,
        message: "no AuthorizationGrant was attached to this request",
      }),
    );
    return;
  }

  const signedGrant: SignedGrant = SignedGrantSchema.parse(rawGrant);
  const expectedResource = options.resolveExpectedResource(review.request.object);
  const outcome = await verifyGrantAgainstAdmission(
    signedGrant,
    review.request,
    options.trustedPublicKey,
    options.now,
    { expectedResource, expectedPolicyVersion: options.expectedPolicyVersion },
  );

  send(
    response,
    200,
    buildAdmissionReviewResponse(
      review.request.uid,
      outcome.allowed ? { allowed: true } : { allowed: false, message: outcome.reason },
    ),
  );
}
