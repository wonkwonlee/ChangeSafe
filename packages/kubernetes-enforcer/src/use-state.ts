/**
 * Single-use enforcement for grants (CS-ADV-018).
 *
 * A grant binds actor, operation, resource, and object state — but for
 * CREATE there is, by definition, no prior state and no resource uid to
 * bind (the object does not exist yet), DELETE is deliberately outside the
 * webhook's registration, and verification itself is stateless. So an
 * actor who can delete the resource could delete it and resubmit the
 * identical grant-bearing manifest, and every check would pass again: one
 * human decision authorizing any number of incarnations until expiry. The
 * M2 design spec deferred use-state "until an attack case demonstrates
 * replay the base shape cannot catch" — this is that case.
 *
 * The registry records a grant as exercised the moment the enforcer
 * answers ALLOW for it, and refuses any later use of the same `grantId`.
 * It is keyed by `grantId` (signed, so unforgeable) and bounded by each
 * grant's own `expiresAtUtc`: an entry is dropped once the grant could no
 * longer verify anyway.
 *
 * Scope is stated honestly rather than oversold: the default registry is
 * process-local. An enforcer restart, or a multi-replica deployment
 * without a shared registry, reopens the replay window for a grant's
 * remaining lifetime. That is still strictly stronger than no use-state,
 * it adds no infrastructure write (the enforcer never touches the cluster;
 * the record lives in its own memory), and the interface exists so a
 * durable backend can replace it without touching verification. The other
 * direction is also deliberate: an ALLOW the API server then fails to
 * persist (a resourceVersion conflict, an etcd error) has still consumed
 * the grant, so the caller needs a fresh one — a false DENY, never a
 * false ALLOW, consistent with "ALLOW is not a persistence attestation"
 * (`docs/M2_TECHNICAL_NOTE.md`).
 */
export interface GrantUseRegistry {
  /**
   * Atomically record `grantId` as exercised. Returns `true` if this call
   * consumed it (first use) and `false` if it had already been consumed.
   * `expiresAtMs` bounds how long the record must be kept; `nowMs` lets
   * the registry discard records for grants that can no longer verify.
   */
  consume(grantId: string, expiresAtMs: number, nowMs: number): boolean;
}

export function createInMemoryGrantUseRegistry(): GrantUseRegistry {
  const consumed = new Map<string, number>();
  return {
    consume(grantId, expiresAtMs, nowMs) {
      // Prune first so a long-lived process does not accumulate records for
      // grants that expired long ago. Linear in the number of live grants,
      // which is small by construction (one per exercised human decision).
      for (const [id, expiry] of consumed) {
        if (expiry <= nowMs) consumed.delete(id);
      }
      if (consumed.has(grantId)) return false;
      consumed.set(grantId, expiresAtMs);
      return true;
    },
  };
}
