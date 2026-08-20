import {
  canonicalize,
  sha256Hex,
  verifyGrantSignature,
  type SignedGrant,
} from "@changesafe/core";
import { canonicalizeAdmittedResource, resourceIdOf } from "@changesafe/domain-kubernetes";

import type { AdmissionRequest } from "./admission-review";

export interface VerifyOptions {
  /** Checked against the grant's recorded policyVersion when supplied. */
  expectedPolicyVersion?: string;
}

export type VerifyOutcome = { allowed: true } | { allowed: false; reason: string };

/**
 * The annotation the grant itself travels in (see src/main.ts's readGrant).
 * A grant is issued against the object's hash *before* the grant is
 * attached to it, so that same annotation must be excluded here too — a
 * grant embedded in the object it authorizes would otherwise invalidate its
 * own object hash the instant it was attached, since the annotation it
 * arrives in wasn't part of what was hashed when the grant was issued.
 */
export const GRANT_ANNOTATION = "changesafe.dev/grant";

/**
 * The one canonical object hash for a Kubernetes resource, over
 * `canonicalizeAdmittedResource` — NOT `normalizeRawResource`, which is a
 * lossy policy projection that discards spec fields no policy currently
 * reads (see CS-ADV-005). Exported because both sides of the grant
 * (issuance and admission-time verification) must compute it identically —
 * a second hand-rolled copy of these lines is exactly the drift that
 * produced CS-ADV-003, so callers use this rather than reimplementing it.
 */
export function kubernetesObjectSha256(raw: unknown): Promise<string> {
  const canonicalized = canonicalizeAdmittedResource(raw, "ev-admission-review");
  const annotations = {
    ...(canonicalized.metadata.annotations as Record<string, string> | undefined),
  };
  delete annotations[GRANT_ANNOTATION];
  return sha256Hex(
    canonicalize({
      identity: canonicalized.identity,
      metadata: { ...canonicalized.metadata, annotations },
      spec: canonicalized.spec,
    }),
  );
}

/**
 * Verify a signed AuthorizationGrant authorizes exactly this admission
 * request: correct signer, actor, operation, resource, object state, and
 * not expired or drifted onto a different policy version.
 *
 * This function only ever returns an explicit allow/deny — it has no
 * concept of "the verifier is unreachable" (that failure mode does not
 * exist inside a synchronous verification call; it is what happens to the
 * *caller* of this function when the whole webhook process is down, which
 * Kubernetes' own `failurePolicy` handles at the ValidatingWebhookConfiguration
 * level — see Task 10).
 */
export async function verifyGrantAgainstAdmission(
  signed: SignedGrant,
  request: AdmissionRequest,
  trustedPublicKey: CryptoKey,
  now: () => Date,
  options: VerifyOptions = {},
): Promise<VerifyOutcome> {
  const signatureVerdict = await verifyGrantSignature(signed, trustedPublicKey);
  if (signatureVerdict !== "valid") {
    return { allowed: false, reason: `grant signature ${signatureVerdict}` };
  }

  const { grant } = signed;

  if (grant.authorizedActor !== request.userInfo.username) {
    return { allowed: false, reason: "authorized actor does not match the requesting identity" };
  }

  // username alone is not stable across a principal's lifetime: deleting
  // and recreating a ServiceAccount preserves its username while
  // Kubernetes assigns the new object a new uid, and a name-based
  // RoleBinding can restore the same access to the replacement — letting
  // it exercise a grant actually issued for the deleted one.
  //
  // Asymmetric on purpose: whether this check applies is the ISSUER's
  // choice (did they bind a uid when they built the grant?), not the
  // ADMISSION REQUEST's. If the grant carries a uid, the request must
  // carry the identical one or be denied outright — silently falling back
  // to username-only whenever the request happened to omit a uid would let
  // an authenticator that never populates `userInfo.uid` (or an attacker
  // routed through one) defeat a grant that specifically opted into
  // uid-binding. A grant issued with NO uid (the caller chose the weaker,
  // still-supported binding) is unaffected either way.
  if (grant.authorizedActorUid !== undefined) {
    if (
      request.userInfo.uid === undefined ||
      grant.authorizedActorUid !== request.userInfo.uid
    ) {
      return { allowed: false, reason: "authorized actor's uid does not match the requesting identity" };
    }
  }

  if (grant.operation !== request.operation) {
    return { allowed: false, reason: "grant operation does not match the requested operation" };
  }

  // Derived from the admitted object itself, the same way
  // kubernetesObjectSha256 derives its hash — this check can never be
  // silently skipped by a caller forgetting to supply it (it previously
  // could, via an optional `expectedResource` option every caller other
  // than the shipped server happened to always pass). Both derivations can
  // throw (an object of an unsupported kind, or otherwise malformed) —
  // caught here, not left to the caller, so this function actually keeps
  // its own documented contract of never throwing. `server.ts` used to
  // catch exactly this by coincidence, because it called an equivalent
  // resolveExpectedResource ahead of this function; removing that
  // parameter removed that incidental protection too, so it has to live
  // here now, not just at the one call site that happened to need it.
  let expectedResource: string;
  let objectSha256: string;
  try {
    const canonicalized = canonicalizeAdmittedResource(request.object, "ev-admission-review");
    expectedResource = resourceIdOf(canonicalized.identity);
    objectSha256 = await kubernetesObjectSha256(request.object);
  } catch {
    return { allowed: false, reason: "the admitted object could not be read" };
  }

  if (grant.resource !== expectedResource) {
    return { allowed: false, reason: "grant resource does not match the requested resource" };
  }

  if (objectSha256 !== grant.objectSha256) {
    return { allowed: false, reason: "requested object does not match the object the grant authorized" };
  }

  if (
    options.expectedPolicyVersion !== undefined &&
    grant.policyVersion !== options.expectedPolicyVersion
  ) {
    return { allowed: false, reason: "grant policy version has drifted from the active policy version" };
  }

  const nowMs = now().getTime();
  if (nowMs >= Date.parse(grant.expiresAtUtc)) {
    return { allowed: false, reason: "grant has expired" };
  }
  if (nowMs < Date.parse(grant.issuedAtUtc)) {
    return { allowed: false, reason: "grant is not yet valid" };
  }

  return { allowed: true };
}
