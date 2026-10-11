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

Two live runs, the same results.

- **Run F**, [CI 38170110682](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38170110682),
  commit `4643466`: the first run, with a wait loop that accepted any
  dry-run failure as "the guard is active" and a fixed sleep for the
  reconcile. It is described in the first draft of this note and is not
  kept in the repository.
- **Run G**, [CI 38171095164](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38171095164),
  commit `211a5c5`: the final harness and summary script, which wait for
  the policy by name, fail the run on an invalid setup, wait for the
  controller to react, and record every annotation of every event. Its raw
  `m4-status-guard-evidence.json` is committed in
  `examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-g/` with one
  string neutralized (a third-party image reference inside the
  last-applied annotations of controller events became
  `registry.example/web:1.0`; invariant 9). The manifest records the
  SHA-256 of the committed file and, as `originalSha256`, of the artifact
  as the run produced it, which is no longer committed. It is replayed by
  `tests/integration/m4-status-guard.test.ts` (artifact checked by hash
  before use; 16 tests). Its `httpStatus` fields are null: the `-v=6`
  output did not match the parser, which now reads kubectl's structured
  form too.

The numbers below are from run G (versions 767, 776, 787 to 798); run F
had the same shape at different versions (763, 772, 782 to 796).

| Step | Result |
| --- | --- |
| status-subresource patch setting the carrier (a new value) | **denied**, exit 1: "ValidatingAdmissionPolicy 'changesafe-protected-status-annotations' with binding 'changesafe-protected-status-annotations' denied request: ChangeSafe protected namespaces do not allow annotation changes through a status subresource...". Version 767 and carrier unchanged |
| JSON patch appending a condition to `status.conditions` | **admitted**, exit 0; version 767 to 776; the condition persisted |
| one pod deleted; Deployment controller reconciles | **not blocked.** Version 776 to 798 over four MODIFIED events: ready replicas 3, 3, 3, then 4. Every annotation of every event was identical to the object's before the deletion |

| # | Prediction | Observed |
| --- | --- | --- |
| H10a | holds (high) | **holds.** The message names the policy and the binding; the object did not move |
| H10b | holds (high) | **holds.** The controller's status writes, which go through the same subresource and the same policy, continued; ready replicas dipped to 3 and recovered to 4 with the guard applied |
| H10c | holds (medium-high) | **holds.** A status write that leaves annotations alone is admitted, including one authored by a user |
| H10d | holds (high) | **not exercised by this experiment's own evidence.** The hashed artifact of this experiment contains no audit data, and the tests do not reference it. The prediction concerns experiment 09's evidence pipeline; it was settled by [experiment 09's second run](M4_EXPERIMENT_09.md#results), where the audit log has both status patches (code 200, no enforcer annotation) next to the denied main-resource request. It is listed here because it was registered here, and credited there |

The surprise criteria were met only in part: the candidate did not break
the controllers, and no exemption surfaced. But the guard's one
discriminating predicate is "annotations differ", and the Deployment
controller's status writes in this run did not touch annotations, so
"controllers not blocked" is scoped to controllers that do not write
annotations through a status subresource. A controller that does (a
Service status writer, say) was never tested, and the second surprise
criterion ("the controller can still set the annotation but the user
cannot") could not have been observed.

## Findings the predictions did not cover

1. **The denial reads "is invalid", not "forbidden".** The API server
   answers `The deployments "web" is invalid: : ValidatingAdmissionPolicy
   ... denied request`. That is the Invalid reason, which carries HTTP 422,
   but the run did not capture the status code (the harness records it
   with `-v=6` since review, and the parser did not match kubectl's
   structured log format in run G; it does now, so a later run's artifact
   would carry it).
   A client that treats only Forbidden as an authorization refusal would
   misread it as a bad request.
2. **The guard does not heal.** The forged carrier from experiment 09's
   probe was already on the object and stayed there: the policy stops new
   changes and says nothing about a value already written. An operator
   who installs it needs to know the objects it protects may already hold
   an arbitrary carrier, and a contract that reads the history (v2c) is
   not affected by what the current object says.
3. **Three lists must track each other, and now a test checks that they
   do.** The webhook rules, the guard and the audit policy each list
   subresources by name. The committed audit policy named only
   `deployments/status` while the webhook and the guard named four kinds,
   so a StatefulSet, DaemonSet or Service status write would have been
   guarded and never audited. The audit policy now lists all four, and
   `tests/integration/m4-status-guard.test.ts` fails if a kind in the
   protected webhook lacks `<kind>/status` in the guard or the audit
   policy.

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

## Corrections after internal review

Two rounds, sixteen findings. The ones that change a claim are above (H10d
credited to the run that settled it; the claim of a "tested control"
narrowed to "a tested candidate refused the observed path in one run"; the
controller claim scoped to controllers that do not write annotations; the
422 stated as inferred). The harness changes: it now **fails** the run if
the guard never refused a dry-run naming its policy, if it is still in
force after removal, if no pod matched, if the delete failed, or if the
Deployment's version never moved after the delete (an invalid setup is not
an observation); it waits for the controller to react before waiting for
the reconcile; it records the HTTP status and, for every controller event,
every annotation. Run G was produced by that harness and carries the annotation fields,
so the controller-annotation claim is checked on it, not asserted
vacuously.

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
