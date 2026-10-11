# Can the executor's write response be bound to the grant it exercised, without trusting the executor?

Status: experiment run 2026-10-11 under the [research loop](STRATEGY.md#the-research-loop-method),
result recorded, **not adopted**. The question comes from
[experiment 01](M4_EXPERIMENT_01.md)'s recorded next question. Offline only;
harness: `tests/integration/m4-executor-claim-binding.test.ts`.

Decision filter: A yes (E1 → E2, continued); B yes (evidence written by the
control plane versus evidence asserted by a party to the change); C yes; D
yes. A record written by the API server about its own handling of the
request is a fourth evidence source. A receipt, a grant, or a state read
cannot stand in for it.

## Hypothesis

**H2:** if the executor reports the `uid` and `resourceVersion` from its
write response, a later read that finds the object at that exact `uid` and
`resourceVersion` confirms the grant-bearing write persisted.

## Method

Two test-local contracts. `ExecutorClaim` is what an executor can assert from
its write response. That response is the stored object. It carries neither the
admission request uid nor anything the enforcer produced. It names a grant only
because the executor says so. `AuditEvent` is modeled on an
`audit.k8s.io/v1` Event at stage `ResponseComplete`. It carries a grant id
only if the enforcer returned one as an admission `auditAnnotation`.
The production function under test is `buildAdmissionReviewResponse`, which
shows what the enforcer leaves behind today. Experiment 01 used
`kubernetesObjectSha256`, and this harness checks it again here.

## Results

| # | Case | H2 | Contract verdict |
| --- | --- | --- | --- |
| 0 | Current enforcer ALLOW response | — | carries no `auditAnnotations`: today, nothing the API server records can name the grant (production code) |
| 1 | Honest executor superseded by a later write; liar claiming a version that never existed | false / false | `unknown_superseded` for both. Reads cannot reach historical versions, so a claim cannot be falsified once any later write lands |
| 2 | Write rejected (409); a reconciler then stores the same spec; the executor claims the reconciler's version | **true** | `claimed_version_present_executor_asserted`. The production hash is fooled too |
| 3 | Read unavailable | false | `unknown_unobserved` |
| 4 | Audit: grant-marked 409, vs grant-marked 200 then unmarked overwrite | — | `audit_write_rejected` vs `audit_write_recorded`. Experiment 01 showed these two paths give byte-identical reads |
| 5 | Audit vs the lying claim from case 2 | — | `audit_contradicts_claim`; the honest claim gives `audit_write_recorded` |
| 6 | Only a reconciler event for the same state | — | `audit_no_event_for_grant` |
| 7 | No audit log | — | `audit_unavailable` |
| 8 | Verdict vocabulary | — | no verdict matches `realized\|reconciled\|verified\|success\|proven` |

**Result: H2 is refuted.** An executor claim cannot be falsified by any
later read once another write lands (case 1). A lying executor can claim
another writer's version and pass (case 2). Executor-reported evidence is
self-asserted, so it adds nothing a read did not already give.

## What the result says, and what it does not

Cases 0–3 test real behavior: the production response builder, the production
hash, and the read-only nature of a state read. **Cases 4–7 test a model,
not Kubernetes.** They show that a server-written record *with this shape*
would separate the paths that reads cannot. They do not show that Kubernetes
writes that record. Their passing is close to true by construction. The
open question is whether the assumptions below hold.

1. **The binding party has to be the control plane, not a party to the
   change.** Approver, authorized actor, and executor each have reasons to
   misreport. Only the API server's own record of how it handled a request
   is evidence that none of them wrote.
2. **The enforcer is the only ChangeSafe component that can tag that
   record.** It cannot see the write's result. If it returns the grant id
   as an `auditAnnotation`, the API server attaches it to the event that
   does carry the result.
3. **Audit evidence is still E2 at most.** A recorded 200 with a stored
   object says what the API server persisted. It says nothing about
   reconciliation or the effect that follows (E3).

## Proposals (not adopted; owner decision per R12)

- **P1.** The enforcer returns `auditAnnotations: { "grant-id": <grantId> }`
  on ALLOW, and on DENY for a parseable grant. This is a read-only addition
  to the response, with no new outbound call. It would need an
  `ENFORCER` version note and a response-shape test.
- **P2.** The SQLite use-state records `request.uid` beside `grant_id`. The
  enforcer would then keep its own E1 record to join against the audit log
  without trusting the annotation path alone.
- **Not proposed:** ChangeSafe reading the audit log. Where audit logs are
  stored and who can read them is the operator's choice. Collecting them
  needs its own read-only boundary design, and that is a separate question.

## Assumptions that need live verification

In order: a kind cluster with an audit policy at `RequestResponse` for
`apps/deployments` should settle all of these.

- A validating webhook's `auditAnnotations` appear on the audit event,
  prefixed with the webhook configuration name. The harness assumes a
  `<prefix>/grant-id` key. The exact prefix is unverified.
- The `ResponseComplete` event for a rejected write (409 conflict after
  admission) still carries the admission annotations.
- `responseObject` is present only at `RequestResponse` level. At
  `Metadata` level, case 5 degrades to `audit_write_recorded` without the
  contradiction check.
- The admission `request.uid` and the audit `auditID` are unrelated
  identifiers. If that is so, the annotation, not either uid, is the join
  key.
- From experiment 01, still open: a validating webhook sees
  `metadata.uid` populated on CREATE.

## Correction after review (2026-10-11)

PR #78's automated review pointed out that resource versions of one
resource type are ordered for kube-apiserver (a conformance requirement
from Kubernetes 1.35). Case 1 assumed reads could not compare versions.

- **A claimed version newer than the current read is refuted.** The
  harness's liar claiming rv 999 against a current rv 150 now gets
  `claim_refuted_future_version`.
- **A claimed past version is still unfalsifiable.** A liar claiming rv 120
  gets the same verdict as the honest executor's rv 101: reads cannot reach
  versions that have since been overwritten.
- **H2 is still refuted.** Case 2, a liar naming another writer's
  *current* version, does not depend on ordering at all.
- Row 4's reference to experiment 01's "byte-identical reads" is narrowed
  by [01's correction](M4_EXPERIMENT_01.md#correction-after-review-2026-10-11):
  the paths are indistinguishable by read once anything was stored after
  admission, which is the case the audit record has to settle.

## What remains unsupported

- No E2 or E3 attestation exists in ChangeSafe today. Nothing here changes that.
- Audit logs can be disabled, sampled, rotated, or written by a compromised
  control plane. `audit_unavailable` is a first-class result, not an
  edge case.
- A record that shows a write persisted does not show that the reviewed
  intent was realized (E3).

## Next question

> **Does the Kubernetes audit record carry an admission webhook's
> annotation through to the response outcome for both persisted and
> rejected writes?**

This is the first question in the loop that offline work cannot answer. It
needs the existing `kind-repro.sh` harness plus an audit policy. That is
heavier than the earlier iterations, so the decision to run it is the owner's.
