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

Pending the CI run.
