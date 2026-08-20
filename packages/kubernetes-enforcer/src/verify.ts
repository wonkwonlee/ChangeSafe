import {
  canonicalize,
  sha256Hex,
  verifyGrantSignature,
  type SignedGrant,
} from "@changesafe/core";
import { normalizeRawResource } from "@changesafe/domain-kubernetes";

import type { AdmissionRequest } from "./admission-review";

export interface VerifyOptions {
  /** Resolved by the caller via @changesafe/domain-kubernetes's resourceIdOf. */
  expectedResource?: string;
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

function objectHashOf(raw: unknown): Promise<string> {
  const normalized = normalizeRawResource(raw, "ev-admission-review");
  const annotations = { ...normalized.metadata.annotations };
  delete annotations[GRANT_ANNOTATION];
  return sha256Hex(
    canonicalize({
      identity: normalized.identity,
      metadata: { ...normalized.metadata, annotations },
      spec: normalized.spec,
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

  if (grant.operation !== request.operation) {
    return { allowed: false, reason: "grant operation does not match the requested operation" };
  }

  if (options.expectedResource !== undefined && grant.resource !== options.expectedResource) {
    return { allowed: false, reason: "grant resource does not match the requested resource" };
  }

  if ((await objectHashOf(request.object)) !== grant.objectSha256) {
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
