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

Run: [CI 38170110682](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38170110682),
commit `4643466`, all seven jobs passed. Evidence: the run's raw
`m4-status-guard-evidence.json`, byte for byte, in
`examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-f/` with its
SHA-256 in `manifest.json`; replayed by
`tests/integration/m4-status-guard.test.ts` (artifact checked by hash before use; 10 tests). The harness waited until a server dry-run of the
forging patch was denied before the probes (`active=yes`).

| Step | Result |
| --- | --- |
| status-subresource patch setting the carrier (a new value) | **denied**, exit 1: "ValidatingAdmissionPolicy 'changesafe-protected-status-annotations' with binding 'changesafe-protected-status-annotations' denied request: ChangeSafe protected namespaces do not allow annotation changes through a status subresource...". Version 763 and carrier unchanged |
| JSON patch appending a condition to `status.conditions` | **admitted**, exit 0; version 763 to 772; the condition persisted |
| one pod deleted; Deployment controller reconciles | **not blocked.** Version 772 to 796 over four MODIFIED events: ready replicas 3, 3, 3, then 4. The annotation was untouched in each |

| # | Prediction | Observed |
| --- | --- | --- |
| H10a | holds (high) | **holds.** The message names the policy and the binding; the object did not move |
| H10b | holds (high) | **holds.** The controller's status writes, which go through the same subresource and the same policy, continued; ready replicas dipped to 3 and recovered to 4 with the guard applied |
| H10c | holds (medium-high) | **holds.** A status write that leaves annotations alone is admitted, including one authored by a user |
| H10d | holds (high) | **not exercised by this experiment's own evidence.** The hashed artifact of this experiment contains no audit data, and the tests do not reference it. The prediction concerns experiment 09's evidence pipeline; it was settled by [experiment 09's second run](M4_EXPERIMENT_09.md#results), where the audit log has both status patches (code 200, no enforcer annotation) next to the denied main-resource request. It is listed here because it was registered here, and credited there |

The surprise criteria were not met: the candidate did not break the
controllers, and no exemption surfaced.

## Findings the predictions did not cover

1. **The denial is an HTTP 422, not a 403.** The API server answers
   "The deployments "web" is invalid" for a policy denial on this path.
   A client that treats only Forbidden as an authorization refusal would
   misread it as a bad request.
2. **The guard does not heal.** The forged carrier from experiment 09's
   probe was already on the object and stayed there: the policy stops new
   changes and says nothing about a value already written. An operator
   who installs it needs to know the objects it protects may already hold
   an arbitrary carrier, and a contract that reads the history (v2c) is
   not affected by what the current object says.
3. **The candidate and the enforcer now share one blind spot less, and
   the audit policy and the guard need to track each other.** The audit
   policy, the webhook rules and the guard each list subresources by
   name. A kind added to one and not the others reopens the path in a
   place no test here covers.

## What this changes in the claims

- With the candidate applied, the *observed bypass* (a patch to
  `deployments/status` that sets the carrier) is refused, on a Deployment
  that already carried a forged carrier, in one run. That is evidence a
  named control closes the path that was found. It is **not** a
  demonstration that a fresh object cannot acquire a carrier by another
  path: the probe changed an existing forged value to a second one, only
  the update path was exercised, only one kind, and no other subresource.
  So experiment 07's protected-tier precondition has a candidate control
  and one run behind it; "assumed" has become "has a tested candidate",
  not "established".
- It does not, by itself, make the carrier unforgeable by everyone: a
  principal who can edit or delete admission policy, or who can change
  the namespace's tier label (denied by the existing guard), is outside
  it.
- The routing guards are **not changed** by this experiment. Adopting the
  candidate, extending it to the other kinds and to the audit policy, is
  the owner's decision (R12), and a re-run of experiments 09 and 10
  against the adopted file is the test of the adoption.

## What remains unsupported

- One kind probed live (Deployment). StatefulSet, DaemonSet and Service
  subresources are named in the policy and not exercised.
- Cluster administrators who control admission policy and RBAC remain
  trusted. The probe uses cluster-admin credentials.
- One Kubernetes version (kind's default node image), a minutes-old
  cluster, one pod deletion.
- The candidate does not address who may update `deployments/status`.

## Where the loop is

Ten experiments are recorded. The central question of M4 (what evidence
can connect an admitted request to stored state) has an answer shaped as
follows, each part with the experiment that tested it and its stated
precondition: a watch or replay from the admission's recorded version,
complete to the object's version at close (05, 06); attributed by a
carrier that only the enforcer's admission can set together with the
state transition (07, 09, 10); sound only where that is true, which in
the tier as deployed needed a control the project did not have (09, 10);
and not available at all where the artifact has no boundary (08). None of
it is adopted into core.

## Next question

> **Can the observation contract be stated once, for core, as a type
> whose every field is either evidence or an explicit precondition, and
> does anything in the repository's existing claim vocabulary already
> overclaim relative to it?**

That is a design memo and a schema, not an experiment, and it is the
owner's call whether the loop writes it.
