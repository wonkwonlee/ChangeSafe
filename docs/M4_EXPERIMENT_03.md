# Does the Kubernetes audit record carry an admission webhook's annotation through to the response outcome for both persisted and rejected writes?

Status: **pre-registered 2026-10-11, before the live run.** The hypotheses
and predictions below were committed before any cluster produced evidence.
The Results section is added afterward, and the predictions are not edited.

This question comes from [experiment 02](M4_EXPERIMENT_02.md)'s recorded
next question. It is the first loop iteration that runs against a live API
server: the CI `admission-reproduction` job's kind cluster, with audit
logging on.

Decision filter: A yes (it tests whether any E2 evidence exists that the
executor cannot forge); B yes (audit stages, webhook annotation
propagation, persistence after admission); C yes; D yes. A record of
persistence that ChangeSafe never writes and cannot forge, joined to a
grant ChangeSafe signed, has no place in the current abstractions.

## What changed before the run

Per R12, these were adopted in their own commit, not in the experiment's.
The owner approved both on 2026-10-11.

- **P1 (adopted):** on every graded answer to a request carrying a readable
  grant, the enforcer returns `auditAnnotations` with `grant-id`,
  `admission-uid` (`request.uid`), and `outcome` (`allow-consumed`,
  `allow-dry-run`, or `deny`). `outcome` is the enforcer's own answer only.
  `admission-uid` was added beyond 02's P1 wording because a dry-run, and a
  refused reuse of the same grant, would otherwise produce events carrying
  the same grant id.
- **P2 (adopted):** the use-state records the consuming `request.uid`
  beside `grant_id`. Existing SQLite files gain the column, and their rows
  read back as `null` ("not recorded"); a uid is never guessed.

## Setup

`examples/m2-kubernetes-enforcer/kind-repro.sh` with
`m4-audit-policy.yaml` (`RequestResponse` for Deployments in the two demo
namespaces, nothing else). In order:

1. **Persisted:** the existing demo step 1 runs a server dry-run, then the
   real write, with grant 1.
2. **Refused reuse:** the existing demo step 2 reuses grant 1 for a
   different object.
3. **Rejected after ALLOW:** grant 2 is issued through the same
   authenticated HTTP path. `m4-downstream-reject.yaml` registers a second
   validating webhook with `failurePolicy: Fail` whose Service does not
   exist; it selects only the label grant 2's object carries.
4. **Burned-grant retry:** the downstream webhook is deleted and the
   identical grant-2 write is retried.

The harness then collects the audit log and the enforcer's use-state, and
`m4-audit-summary.mjs` prints every annotated event. It fails the run only
when the setup itself breaks, never when a hypothesis fails to hold.

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H3a | The enforcer's `auditAnnotations` appear on the API server's `ResponseComplete` event, keyed `<webhook name>/<key>` (`protected.enforcer.changesafe.dev/grant-id`) | holds | medium: the exact prefix is from memory of the API, not verified |
| H3b | When a later admission stage rejects a request the enforcer allowed, the audit event still carries the enforcer's annotations with `outcome=allow-consumed` and a non-2xx response code | holds | low to medium: annotations from a webhook whose verdict did not decide the request might be dropped |
| H3c | Dry-run requests are audited and carry `outcome=allow-dry-run`, so `grant-id` alone matches more than one event; 02's "first event for the grant" rule in `bindAudit` picks the wrong one | holds | medium |
| H3d | The retry of grant 2 is denied as already exercised, and the use-state names the rejected admission's uid as the consumer: a grant burned by a write that never persisted | holds | high: M3 modeled it, and P2 records it |
| H3e | The audit `auditID` and the admission `request.uid` are different identifiers, so the annotation, not either id, is the join key | holds | medium |

If H3b fails, the audit log cannot tell "the enforcer allowed and something
later rejected" from "the enforcer was never asked", and P1 does not close
02's gap for the rejected-write path. That is the result that matters most.

## Results

Run: [CI 38161664015](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38161664015),
commit `c331918`, all seven jobs passed. Trimmed evidence:
`examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-audit-events.json`
(raw artifact SHA-256 `d218ff1d…205546`). It is replayed offline by
`tests/integration/m4-audit-evidence.test.ts`, so the result stays
checkable after the artifact expires. The audit log held 21 events; the
enforcer annotated 5.

| Event | Request | API server code | `outcome` | Stored object |
| --- | --- | --- | --- | --- |
| grant 1, dry-run | `?dryRun=All` | 200 | `allow-dry-run` | rv 695, replicas 4 |
| grant 1, actual write | | 200 | `allow-consumed` | rv 710, replicas 4 |
| grant 1, reuse for another object | | 400 | `deny` | — |
| grant 2, downstream webhook rejects | | 500 | `allow-consumed` | — |
| grant 2, retry after removing it | | 400 | `deny` ("already exercised") | — |

The enforcer's use-state named exactly two consumers. Each joined, by
admission uid, to one `allow-consumed` event: grant 1 to the 200, grant 2
to the 500.

| # | Prediction | Observed |
| --- | --- | --- |
| H3a | holds | **holds.** Keys are `protected.enforcer.changesafe.dev/{grant-id,admission-uid,outcome}`, the webhook's name as prefix |
| H3b | holds (low to medium confidence) | **holds.** The rejected-after-ALLOW event keeps `outcome=allow-consumed` and records 500, with no stored object |
| H3c | holds | **holds, and it refutes experiment 02's rule.** See below |
| H3d | holds | **holds.** Retry denied as already exercised; replicas stayed 4; the recorded consumer is the rejected admission. A grant spent on a write that never persisted, on a live API server |
| H3e | holds | **not refuted.** All five audit ids differ from the admission uid they carry |

**The counterexample.** Experiment 02's `bindAudit` took the first audit
event naming a grant. For grant 1 that is the dry-run. Its 200 response
carries an object at rv 695 with replicas 4. A dry-run returns the version
it read, and that version held replicas 3, so this pair was never stored.
Against the honest executor's real version (710), 02's rule reports
`audit_contradicts_claim`: a false contradiction drawn from a state that
never existed. The grant id cannot single out the write. The admission uid,
recorded by P2 and carried by P1, does. That is the reason
`admission-uid` was added to P1 before the run, and the run confirms it
was needed. 02's harness is left as it was recorded; this note and ledger
row 03 carry the correction.

All five predictions held. The surprises were details, not verdicts: a
dry-run response that looks like stored state, and enforcer denials
recorded as 400, which the response code alone cannot tell apart from any
other bad request. The `outcome` annotation can.

## What the result says about the architecture

1. **The API server can record E1 → E2 evidence that no party to the
   change writes.** For a consumed grant, the audit event joined by
   admission uid says whether the API server answered with a stored object
   (200, rv 710) or failed the request (500). That separates the paths
   [experiment 01](M4_EXPERIMENT_01.md#correction-after-review-2026-10-11)
   showed a read cannot separate once anything else is stored after
   admission. It holds under this run's setup, not in general.
2. **The join key has to be per admission, not per grant.** Single-use
   authority does not make the grant id unique in the audit log: dry-runs
   and refused reuses carry it too.
3. **This evidence belongs to the operator, not to ChangeSafe.** Audit
   policy, sinks, retention and integrity are cluster-operator controls.
   An absent event is `unknown`, and a party who controls the audit
   pipeline could drop or alter events. ChangeSafe signs grants, but
   nothing it signs covers an audit event.

## What remains unsupported

- No E2 attestation exists in ChangeSafe. The evidence above is an audit
  record ChangeSafe neither writes nor signs, read by a test.
- One run, one Kubernetes version (kind v0.32.0's default node image), one
  rejection mechanism (a failing webhook). A rejection after the
  validating phase, such as a storage conflict or an etcd error, was not
  produced. Whether such a request still carries the annotations is
  untested.
- E3 is out of scope, as before.
- Still open from [experiment 01](M4_EXPERIMENT_01.md): whether a
  validating webhook sees `metadata.uid` on CREATE.

## Next question

> **What can a party who controls the audit pipeline make an E2
> observation say, and what must the observation carry so that dropping or
> altering an event degrades to `unknown` rather than to a wrong verdict?**

This is the adversarial version of today's positive result, the attack
model a CS-ADV entry would need before any observation contract is
proposed for core. Like 01 and 02, it can start offline from the recorded
evidence.
