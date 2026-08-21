import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { SignedGrant } from "@changesafe/core";
import { SignedGrantSchema } from "@changesafe/core";
import { POLICY_VERSION } from "@changesafe/domain-kubernetes";

import {
  AdmissionReviewRequestSchema,
  buildAdmissionReviewResponse,
  type AdmissionReviewRequest,
} from "./admission-review";
import { createInMemoryGrantUseRegistry, type GrantUseRegistry } from "./use-state";
import { verifyGrantAgainstAdmission } from "./verify";

// kube-apiserver's own `--max-request-bytes` defaults to 3 MiB per request,
// so a single Deployment/StatefulSet/etc. is bounded at that size. An
// UPDATE's AdmissionReview carries the object TWICE (`request.object` and
// `request.oldObject`), so a legitimately-sized update can approach 2x that
// before envelope overhead. 1 MiB was too tight: a valid, ordinary UPDATE
// could exceed it, and the too-large path (below) cannot echo the request's
// `uid` once `readBody` has thrown, which Kubernetes treats as a malformed
// webhook response — a webhook-unreachable failure, not a denial — so on
// `webhook-default.yaml`'s `failurePolicy: Ignore` this let a merely large
// but legitimate update bypass verification entirely. 8 MiB comfortably
// covers the realistic worst case (2x the apiserver's default per-object
// ceiling, plus envelope overhead) while still bounding memory against a
// genuinely oversized/malicious body.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The policy version a deployed enforcer holds grants to. `EXPECTED_POLICY_VERSION`
 * overrides; otherwise the bundled domain's own `POLICY_VERSION` is the
 * binding — the enforcer image is built from the same checkout as the
 * policies it guards, so that constant IS the active policy set. Leaving
 * this unbound is not an option a deployment can take by omission
 * (CS-ADV-017): a signing key that survives a policy upgrade would
 * otherwise keep every unexpired grant issued under the obsolete policies
 * admissible, because `verifyGrantAgainstAdmission` skips the drift
 * comparison when no expectation is supplied. An empty string counts as
 * unset, matching how the rest of the entrypoint reads its environment.
 */
export function resolveExpectedPolicyVersion(env: Readonly<Record<string, string | undefined>>): string {
  const override = env.EXPECTED_POLICY_VERSION;
  return override !== undefined && override.length > 0 ? override : POLICY_VERSION;
}

export interface EnforcerServerOptions {
  trustedPublicKey: CryptoKey;
  now: () => Date;
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
  /**
   * Where exercised grants are recorded so a grant is honoured at most once
   * (CS-ADV-018). Defaults to a process-local in-memory registry, created
   * once per listener; see `use-state.ts` for what that does and does not
   * cover. Inject a shared/durable implementation for multi-replica
   * deployments.
   */
  grantUses?: GrantUseRegistry;
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
  // One registry per listener, not per request: the whole point is that
  // the record outlives the request that created it.
  const resolved: EnforcerServerOptions = {
    ...options,
    grantUses: options.grantUses ?? createInMemoryGrantUseRegistry(),
  };
  return (request, response) => {
    void handle(request, response, resolved).catch(() => {
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

  // Bad input is an answer, not an outage.
  //
  // Kubernetes treats any non-2xx webhook reply as "the webhook could not be
  // called" and applies `failurePolicy` — which on the default-tier webhook
  // is `Ignore`, i.e. ADMIT. So letting a schema-validation failure escape to
  // the generic 500 handler would make a *malformed* grant annotation
  // strictly weaker than no grant at all: a missing grant denies (below),
  // while a garbage one would fail open. The verifier received input it can
  // read a verdict from, so it answers 200 with an explicit denial instead.
  // The 500/`failurePolicy` path stays reserved for the condition verify.ts
  // documents as outside its responsibility: the verifier process itself
  // being unreachable.
  let raw: unknown;
  let review: AdmissionReviewRequest;
  try {
    raw = await readBody(request);
    review = AdmissionReviewRequestSchema.parse(raw);
  } catch {
    // No parsed review means no trustworthy uid; recover it best-effort so a
    // real API server can still correlate the denial with its request.
    send(response, 200, buildAdmissionReviewResponse(recoverUid(raw), {
      allowed: false,
      message: "admission review request could not be read",
    }));
    return;
  }

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

  let signedGrant: SignedGrant;
  try {
    signedGrant = SignedGrantSchema.parse(rawGrant);
  } catch {
    send(
      response,
      200,
      buildAdmissionReviewResponse(review.request.uid, {
        allowed: false,
        message: "the attached AuthorizationGrant could not be read",
      }),
    );
    return;
  }

  // Resource resolution and object normalization now happen inside
  // verifyGrantAgainstAdmission itself (it derives the expected resource
  // from the admitted object directly, rather than trusting a caller to
  // supply it — see CS-ADV-011), and that function catches its own
  // normalization failures rather than throwing, so no separate try/catch
  // is needed here for that case.
  const outcome = await verifyGrantAgainstAdmission(
    signedGrant,
    review.request,
    options.trustedPublicKey,
    options.now,
    { expectedPolicyVersion: options.expectedPolicyVersion },
  );

  // Use-state is checked LAST, and only on an otherwise-valid grant, so a
  // denied attempt never consumes anything: a mistyped patch must not burn
  // the human decision it was trying to exercise. On ALLOW the grant is
  // consumed in the same synchronous step that decides the answer, so two
  // concurrent attempts cannot both see it unused (Node's event loop makes
  // consume() atomic within this process — the registry's documented
  // scope). `grantUses` is always set by createEnforcerRequestListener;
  // the fallback only exists for direct callers of handle() in tests.
  const result =
    !outcome.allowed
      ? { allowed: false as const, message: outcome.reason }
      : (options.grantUses ?? createInMemoryGrantUseRegistry()).consume(
            signedGrant.grant.grantId,
            Date.parse(signedGrant.grant.expiresAtUtc),
            options.now().getTime(),
          )
        ? { allowed: true as const }
        : {
            allowed: false as const,
            message: "grant has already been exercised; a grant authorizes exactly one admission",
          };

  send(response, 200, buildAdmissionReviewResponse(review.request.uid, result));
}

/** Best-effort `request.uid` from a body that failed schema validation. */
function recoverUid(raw: unknown): string {
  const uid = (raw as { request?: { uid?: unknown } } | null)?.request?.uid;
  return typeof uid === "string" ? uid : "";
}
