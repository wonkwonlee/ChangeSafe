# Does a policy that denies annotation changes on the status subresource close the carrier path without blocking the controllers?

Status: **pre-registered 2026-10-11, before the candidate policy or the
probe was written.** The hypotheses and predictions below were committed
first. The Results section is added afterward, and the predictions are not
edited.

[Experiment 09](M4_EXPERIMENT_09.md) found that the grant carrier can be
set outside the enforcer in the protected tier as deployed: a patch to
`deployments/web/status` was admitted, persisted, and replaced the real
carrier. It proposed two mitigations and adopted neither, because changing
`routing-guards.yaml` is the owner's decision (R12). This iteration tests
the first one **without adopting it**: a candidate policy in its own file,
applied only inside the experiment's disposable cluster, whose effect is
measured and whose adoption remains the owner's.

Decision filter: A yes (is the protected-tier precondition restorable
without a new component); B yes (what a status-subresource admission policy
can see, controllers' own writes through the same path); C yes; D yes. A
closed path would let the project state experiment 07's contract with its
precondition **met by a named, tested control** instead of assumed.

## The candidate

`examples/m2-kubernetes-enforcer/m4-status-guard-candidate.yaml`, a
`ValidatingAdmissionPolicy` and binding in the same family and style as the
existing routing guards (CEL, `failurePolicy: Fail`, bound to namespaces
labelled `changesafe.dev/tier: protected` through the binding's
`matchResources.namespaceSelector`). It matches UPDATE of
`deployments/status`, `statefulsets/status`, `daemonsets/status` and
`services/status` and denies the request when
`metadata.annotations` differs between the old and the new object. A
status write that leaves annotations alone is untouched.

It is **not** added to `routing-guards.yaml`. The harness applies it only
for this experiment's steps.

## What is attempted

1. With the candidate applied, the experiment 09 status-subresource patch
   is repeated with a new value.
2. A real status change is produced by the Deployment controller: a pod of
   the Deployment is deleted, the ReplicaSet recreates it, and the
   controller writes `deployments/status` (ready and available replicas).
   The harness's watch is read for those events.
3. The object, the carrier and the audit log are read back.

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H10a | With the candidate applied, the status patch that sets the carrier is denied, the message names the policy, and the object's carrier and version are unchanged | holds | high |
| H10b | The Deployment controller's own status writes are not blocked: after the pod is deleted the Deployment's `status` changes again (a watch event with a changed `readyReplicas` or `availableReplicas`) while the guard is applied | holds | high |
| H10c | The status patch that does not touch annotations (a harmless status field) is still admitted | holds | medium-high: a user-authored status patch is unusual, and the policy is untried |
| H10d | Experiment 09's audit gap is closed: the audit evidence now shows the status writes of experiment 09's probe with no enforcer annotation, so the webhook was not called for them | holds | high: the audit policy lists the subresource now |

**What would count as a surprising result.** If H10b fails, the candidate
breaks the controllers and cannot be adopted as written; if the controller
can still set the annotation but the user cannot, an exemption exists the
policy did not account for. If H10a fails, the subresource is reachable by
another path (a different verb, or the main resource's `PUT` with status)
and the mitigation is incomplete.

## Limits stated in advance

- One kind probed live (Deployment). The policy names StatefulSet,
  DaemonSet and Service subresources and they are not exercised.
- Cluster administrators who control admission policy and RBAC remain
  trusted (the existing guards say the same); this experiment does not
  show that a principal who can delete or edit a ValidatingAdmissionPolicy
  cannot undo it.
- The candidate does not address who may update `deployments/status` (an
  RBAC question), only what the update may change.

## Results

Pending the CI run.
