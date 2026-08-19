# M2 — AuthorizationGrant: bind authorization to enforcement

**Date:** 2026-08-19

**Status:** Proposed for owner review

**Branch:** `wonkwonlee/main`

**Scope:** Introduce `AuthorizationGrant` as a new `packages/core` primitive,
extend `packages/server` to issue one after an approved decision, and add a
new `packages/kubernetes-enforcer` package that verifies grants at a
Kubernetes admission-webhook boundary. Kubernetes is the test environment for
this milestone, not the subject — the grant primitive itself stays
domain-agnostic in core.

This spec covers design only. Implementation follows via the
`writing-plans` skill after owner review.

## Central question

> Can a ChangeSafe authorization be exercised only by the authorized actor,
> for the exact operation, resource, and canonical object it was issued for?

Per `docs/STRATEGY.md` / `docs/STRATEGY.agent.md`, M2 is where the first
genuinely new core abstraction appears since P2. `docs/STRATEGY.agent.md`
R3 forbids implementing `AuthorizationGrant` or any authority semantics
before a milestone M2 planning artifact exists — this spec is that artifact.

## Decision 1 — Module boundary

`AuthorizationGrant`'s schema and Ed25519 signing/verification logic live in
`packages/core`, alongside `receipt.ts` / `signature.ts`, not in a new
`packages/authorization` package.

Rationale:

- The grant is pure data + a Web Crypto signature, structurally identical to
  `ChangeReceipt` — zero IO, so it fits core's existing zod-only contract
  without adding a dependency.
- Existing precedent for a *separate* package is IO, not concept: `ledger`
  depends on `node:sqlite`; `kubernetes-collector` depends on
  `@kubernetes/client-node`. Neither precedent applies to the grant type or
  its pure verification function.
- A grant references `receipt_id`. Splitting grant into its own package
  would force it to depend on core for the receipt schema, while core (or a
  future domain) might eventually need to reason about grants — a diamond
  dependency with no IO-driven reason to accept it.
- `docs/STRATEGY.agent.md` §8 ("Physical OS") names a long-term hypothesis
  that authorization may generalize beyond infrastructure
  (`proposal → authorization → capability → effect → observation →
  verification`). That hypothesis's own promotion condition is "the
  abstractions keep reappearing on their own" — not a license to
  pre-architect for it now. But *if* it materializes later, core (the one
  package every domain and future subsystem already depends on) is the
  cheapest place to have put the primitive.

The Kubernetes-specific enforcement point is a new IO-bound package,
`packages/kubernetes-enforcer`, following the naming and dependency shape of
`packages/kubernetes-collector` (`@changesafe/domain-kubernetes` +
`@kubernetes/client-node` + `zod`). It must not be shaped as a `DomainAdapter`
— `docs/STRATEGY.agent.md` R6 forbids a fourth `domain-*` package, and this
isn't a domain in that sense: it consumes core's pure grant-verification
function and does no policy evaluation of its own.

## Decision 2 — Issuance authority

`packages/server` issues the grant, not the CLI. This is not a new design
choice so much as a consequence of one that already exists:
`changesafe gate` (CLI) never produces an `"approved"` decision — only
`gate_only` or `blocked` (`packages/cli/src/gate.ts:228`). Only
`packages/server`'s authenticated OIDC approver flow
(`POST /reviews/:id/decisions`) produces `"approved"`, and it already holds
the approver identity, a signing key, and the receipt — everything a grant
needs.

Grant issuance happens in the same request that produces the approved,
signed receipt. The caller supplies `authorized_actor` explicitly (may differ
from the approver — approver/authorized_actor/executor stay unequal per
`docs/STRATEGY.md` §"Authority vocabulary") and a required `expires_at` with
no silent default, matching the project's existing "no implicit approval"
posture.

## Decision 3 — Identity representation (`authorized_actor`)

`authorized_actor` is a Kubernetes identity string as the K8s API server
itself would report it (e.g. `system:serviceaccount:ns:name`, or a mapped
OIDC subject) — not a ChangeSafe-owned identity or claim system.

At enforcement time, `kubernetes-enforcer` compares `grant.authorized_actor`
against `AdmissionReview.request.userInfo` from the webhook payload — an
identity the K8s API server already authenticated before the request ever
reaches ChangeSafe. This keeps "Kubernetes is the test environment, not the
subject" true in practice, and avoids `docs/STRATEGY.agent.md` R7 (no
JWT/OAuth/SPIFFE/Zanzibar-style ecosystem as a starting design) by not
building an identity system at all.

## Decision 4 — `failurePolicy` classification (fail-open vs fail-closed)

Reuses the existing `changesafe.dev/protected: "true"` annotation
(`packages/domain-kubernetes/src/policies/protected-resource.ts`,
`K8S_PROTECTED_RESOURCE`) rather than inventing a new classification or
re-deriving risk level at admission time.

Two distinct failure modes, not one:

| Condition | Behavior |
| --- | --- |
| Grant missing, signature invalid, `object_sha256` mismatch, actor mismatch, expired | **Always deny.** The verifier ran and found a real mismatch; `changesafe.dev/protected` is irrelevant here. |
| The webhook itself is unreachable/times out/crashes | `changesafe.dev/protected: "true"` on the target object → deny (fail-closed, K8s `failurePolicy: Fail`). Otherwise → allow (fail-open, `failurePolicy: Ignore`). |

Collapsing these two into one "fail-closed is safer" rule would be wrong:
fail-open only ever applies when the verifier *cannot answer*, never when it
answered "no."

## Decision 5 — `object_sha256` canonicalization

Computed over the existing normalization pipeline
(`packages/domain-kubernetes/src/normalize.ts` → `KubernetesResourceSchema`),
applied identically at gate time (to the proposed manifest) and at admission
time (to `AdmissionReview.request.object`).

Because that schema uses `z.looseObject` to keep only known, policy-relevant
fields, K8s server-side additions (`uid`, `resourceVersion`, `managedFields`,
`creationTimestamp`, defaulted fields) are dropped before hashing on both
sides — they never appear in the hash input, so ordinary admission-time
defaulting cannot produce a false "mutated after authorization" BLOCK. A real
spec change still changes the hash, because it changes the normalized value.
No new normalization logic is needed; this reuses what policy evaluation
already does.

## Data flow

```
1. changesafe serve: approver authenticates via OIDC, POST /reviews/:id/decisions
2. DecisionService: create + sign receipt (decision="approved"), append to ledger [existing]
3. NEW: same request also issues an AuthorizationGrant
   - receipt_id = the receipt just created
   - authorized_actor = supplied by the approver's request (may != approver)
   - operation, resource, object_sha256 = derived from the same evaluated proposal (never re-entered)
   - expires_at = required, no default
   - signed via core's grant signing, mirroring receipt signing
4. kubectl apply reaches the K8s API server; API server authenticates the caller (userInfo)
5. kubernetes-enforcer receives the AdmissionReview:
   - verify grant signature
   - authorized_actor == request.userInfo (Decision 3)
   - object_sha256 == normalize(request.object) (Decision 5)
   - resource/operation match the request
   - not expired
   - all pass → allow; any check fails → deny (Decision 4, top row)
   - webhook itself unavailable → protected-annotation-driven fail-open/closed (Decision 4, bottom row)
```

**How a grant physically reaches the webhook** (annotation on the applied
object vs. a side-channel) is left as an implementation-time experiment
against a real kind cluster, not decided here — K8s's admission API shape
constrains this more than architecture preference does.

## Explicitly deferred (YAGNI; counterexample-driven per `docs/STRATEGY.agent.md` R7)

Not built in this pass. Each is a candidate M2 adversarial-gate attack case;
build only if that exercise produces a real counterexample:

- **Grants in the ledger.** `packages/ledger` stays receipt-only. Attack
  case to test: can a grant exist and be exercised with no durable record
  that it was ever issued? If the M2 adversarial gate finds this is a real
  audit gap, extend the ledger then.
- **Nonce / use-state / revocation.** Not implemented until an attack case
  demonstrates replay or reuse the base shape (signature + expiry + exact
  object/operation/resource binding) cannot already catch.
- **A ChangeSafe-owned identity/claims system.** Explicitly rejected by
  Decision 3, not merely deferred.

## Explicit non-claims

`ALLOW` at the enforcement boundary is not a persistence attestation
(E0 → E1 binding only, per `docs/STRATEGY.md` claim discipline). It does not
mean the K8s API server accepted the request (E2) or that a controller
realized the intended state (E3). This must be stated in the M2 deliverable
documentation, not only implied by architecture.

## Deliverables (per `docs/STRATEGY.md` M2)

- kind/local cluster reproduction of the full data-flow above
- failure-mode document (the two-row table in Decision 4, expanded with
  observed behavior)
- E1/E2/E3 gap written up as an explicit open question
- adversarial release gate: object substitution, resource substitution,
  operation substitution, identity substitution, replay, stale/expired
  grant, policy version drift, request mutated after authorization — plus
  the ledger and nonce/revocation questions listed above as candidate cases
- 90-second demo: authorize → exercise correctly (ALLOW) → reuse the same
  grant against a modified object (DENY) → fail-closed when the verifier is
  unavailable on a protected resource

## Open questions carried into implementation

1. How a grant is physically attached to a `kubectl apply` request (Data
   flow, step 4) — resolve empirically against a kind cluster.
2. Exact `AuthorizationGrant` wire schema beyond the minimal shape already
   fixed by `docs/STRATEGY.md` (`grant_id, receipt_id, authorized_actor,
   operation, resource, object_sha256, policy_version, issued_at,
   expires_at, signature`) — no new fields anticipated, but implementation
   may surface one.
3. Whether `packages/server`'s decision endpoint takes `authorized_actor` and
   `expires_at` as new request fields or a separate follow-up endpoint —
   left to the implementation plan.
