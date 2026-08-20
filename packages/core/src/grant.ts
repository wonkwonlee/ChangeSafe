import { z } from "zod";
import { IdSchema, Sha256HexSchema, TimestampSchema } from "./primitives";

/**
 * What kind of admission request the grant authorizes, mirroring the
 * Kubernetes admission.k8s.io/v1 `operation` field exactly so an enforcement
 * point can compare without translation.
 */
export const GrantOperationSchema = z.enum(["CREATE", "UPDATE", "DELETE", "CONNECT"]);

/**
 * Binds one prior decision (`receiptId`) to exactly one actor, operation,
 * resource, and object state that may exercise it at an enforcement
 * boundary. Deliberately domain-agnostic: `resource` and `objectSha256` are
 * opaque strings a domain's own normalization pipeline produces — core does
 * not know they came from Kubernetes.
 *
 * Minimal shape per docs/STRATEGY.md M2: extend only when a counterexample
 * demands it (nonce, use-state, revocation, ...), never speculatively.
 */
export const AuthorizationGrantSchema = z
  .strictObject({
    grantId: IdSchema,
    /** The approved `ChangeReceipt` this grant was issued from. */
    receiptId: IdSchema,
    /**
     * The identity that may exercise this grant, in the enforcement
     * boundary's own vocabulary (e.g. Kubernetes' `userInfo.username`).
     * Never a ChangeSafe-owned identity or claim.
     */
    authorizedActor: z.string().min(1).max(255),
    /**
     * The same identity's stable Kubernetes `userInfo.uid`, when the caller
     * has one to bind. `username` alone is not stable across a principal's
     * lifetime: deleting and recreating a ServiceAccount preserves its
     * username while Kubernetes assigns the new object a new `uid`, and a
     * name-based RoleBinding can restore the same access to the replacement
     * — letting it exercise a grant that was actually issued for the
     * deleted one. Still the enforcement boundary's own vocabulary, not a
     * new identity system: `userInfo.uid` is a field Kubernetes' own
     * `AdmissionReview.request.userInfo` already carries. Optional because
     * not every identity provider populates a stable uid; when either side
     * lacks one, verification falls back to the username-only comparison.
     */
    authorizedActorUid: z.string().min(1).max(255).optional(),
    operation: GrantOperationSchema,
    /** Opaque stable resource identifier from the domain's own scheme. */
    resource: z.string().min(1).max(128),
    /** Hash of the domain-normalized object this grant was issued against. */
    objectSha256: Sha256HexSchema,
    /**
     * Hash of the object's state *before* the reviewed change. Required for
     * UPDATE (enforced below): without it, a grant approving a reviewed
     * transition (e.g. image v1 -> v2) binds only the target state — if the
     * object diverges after issuance (an unreviewed v1 -> v3), the same
     * grant still matches on `objectSha256` alone and can be replayed to
     * force the object back to v2 from v3, a transition nobody reviewed
     * (`CS-ADV-014`). Unlike `authorizedActorUid` (optional because some
     * identity providers genuinely never populate a uid), every UPDATE has
     * a prior state by definition — there is no legitimate case for an
     * UPDATE grant to omit this, so it is not optional for that operation.
     * Absent (and inapplicable) for CREATE, which has no prior state to
     * bind against at all. Still caller-asserted at issuance like
     * `objectSha256` itself — deriving it server-side from the evaluated
     * proposal remains deferred, see `CS-ADV-004`.
     */
    oldObjectSha256: Sha256HexSchema.optional(),
    /**
     * The composed policy version of the receipt this grant came from, e.g.
     * `core-v0.2.0+kubernetes-v0.1.0`. Bounded generously: real composed
     * values are already ~30 characters, so a tighter bound would start
     * rejecting legitimate receipts after a couple of version-digit growths.
     */
    policyVersion: z.string().min(1).max(64),
    issuedAtUtc: TimestampSchema,
    expiresAtUtc: TimestampSchema,
  })
  .superRefine((grant, ctx) => {
    if (Date.parse(grant.expiresAtUtc) <= Date.parse(grant.issuedAtUtc)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAtUtc"],
        message: "expiresAtUtc must be strictly after issuedAtUtc",
      });
    }
    if (grant.operation === "UPDATE" && grant.oldObjectSha256 === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["oldObjectSha256"],
        message: "oldObjectSha256 is required for an UPDATE grant — every UPDATE has a prior state to bind against, unlike CREATE",
      });
    }
    if (grant.operation === "CREATE" && grant.oldObjectSha256 !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["oldObjectSha256"],
        message: "oldObjectSha256 must be absent for a CREATE grant — CREATE has no prior state, and admitting one here would let a stale prior-state hash silently pass validation without ever being checked against anything",
      });
    }
  });

export type AuthorizationGrant = z.infer<typeof AuthorizationGrantSchema>;
