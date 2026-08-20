import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { SignedGrant } from "@changesafe/core";
import { SignedGrantSchema } from "@changesafe/core";

import { AdmissionReviewRequestSchema, buildAdmissionReviewResponse } from "./admission-review";
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
   * How the grant physically arrives with the request. Left injectable —
   * Task 10 decides and hard-codes the real mechanism (an annotation on the
   * admitted object vs. a header vs. something else); this test seam is
   * intentional per the spec's "resolve empirically" note.
   */
  readGrant: (request: IncomingMessage) => unknown | null;
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

export function createEnforcerServer(options: EnforcerServerOptions): Server {
  return createServer((request, response) => {
    void handle(request, response, options).catch(() => {
      send(response, 500, { error: "internal error" });
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: EnforcerServerOptions,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/validate") {
    send(response, 404, { error: "not found" });
    return;
  }

  const review = AdmissionReviewRequestSchema.parse(await readBody(request));
  const rawGrant = options.readGrant(request);

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
