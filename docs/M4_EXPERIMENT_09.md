# Can a write that does not pass through the enforcer set the grant carrier in the protected tier?

Status: **pre-registered 2026-10-11, before the probe was written.** The
hypotheses and predictions below were committed first. The Results section
is added afterward, and the predictions are not edited.

[Experiment 07](M4_EXPERIMENT_07.md)'s contract is sound in the protected
tier only if nothing outside the enforcer's webhook can set the grant
carrier (`changesafe.dev/grant`) on a stored object. That is a
*precondition*, assumed there and, in [experiment 05](M4_EXPERIMENT_05.md),
only observed not to have been violated in three short runs. [Experiment
08](M4_EXPERIMENT_08.md) found that for Terraform the precondition cannot be
met at all. This iteration tests it where it is supposed to hold, by
attacking it.

The webhook is registered for `deployments`, `statefulsets`, `daemonsets`
and `services` on CREATE and UPDATE. An API server serves other paths to
the same object. The one most likely to matter is the **`status`
subresource**: an UPDATE or PATCH to `deployments/status` is a different
resource name (`deployments/status`) from the one the webhook matches, so
the webhook is not called, and Kubernetes' status strategy for a Deployment
resets some fields from the old object (the spec and the labels) but is not
documented, to the author's knowledge, as resetting annotations. If it does
not, a principal with update access to `deployments/status` can set any
annotation, including the carrier, without an admission.

Decision filter: A yes (it tests the single premise the whole contract
rests on, adversarially); B yes (subresources as separate admission
targets, status strategies); C yes; D yes. A confirmed bypass would be the
first finding of the loop that is an adversarial finding about *shipped*
behavior rather than about a candidate design, and the first that would
open a `CS-ADV` entry.

## What is attempted

All against the demo Deployment in the protected namespace, after the other
M4 steps, with the harness's cluster-admin credentials. These are API write
paths, not administrative changes to the webhook or the routing guards:

1. `kubectl annotate` on the main resource with `changesafe.dev/grant`
   set to a string that is not a grant.
2. A merge patch to the **status subresource** setting the same annotation.
3. A merge patch to the status subresource attempting to change
   `spec.replicas` and a label in the same request.
4. The object is read back after each, and the API server's audit log is
   read for the requests.

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H9a | The status-subresource patch setting the carrier annotation is admitted and the annotation persists: the carrier is writable outside the enforcer | holds | medium (about 60 percent): this rests on the status strategy not resetting annotations, which the author has not verified |
| H9b | The same annotation set through the main resource is denied by the enforcer | holds | high |
| H9c | A status-subresource write cannot change `spec.replicas` or labels, so the object's enforcer hash is unchanged by it | holds | high |
| H9d | The audit log shows the status write with no enforcer annotation, and no `AdmissionReview` for the enforcer: the webhook was not called | holds if H9a holds | medium-high |

**What would count as a surprising result.** If H9a fails (the status
write is rejected or ignores the annotation), the carrier survived the most
likely bypass, and experiment 05's observation gains real weight; the
precondition is then supported on this path, not established. If H9c
fails, the status subresource can change spec, which is a much larger
finding than a carrier.

## Consequence stated in advance

If H9a holds, experiment 07's carrier-keyed contract (v2b) cannot assume the
carrier unforgeable in the protected tier **as deployed**, and the right
reading of 07's default-tier result applies to it: sound only when it says
unknown for presence. The harm is bounded: a status write cannot change the
spec, so it cannot create the *target state*, and the contract requires both
the target hash and the carrier. A forger can re-attribute a state that
another grant legitimately stored to a different grant with the same target
(for example a retry after a rejection). Whether that matters is a question
for the owner, and closing the path is a routing-guard change that this
experiment proposes and does not make (R12).

## Limits stated in advance

- The probe uses cluster-admin credentials, which can always do this. What
  it shows is the API server's behavior for the subresource, not that an
  ordinary principal has the permission; who holds `update` on
  `deployments/status` is an RBAC question this run does not answer.
- One Kubernetes version (kind's default node image), one resource kind.
- Other subresources and other kinds (StatefulSet, DaemonSet, Service) are
  not probed.

## Results

Run: [CI 38169577003](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38169577003),
commit `5f708f1`, all seven jobs passed. Evidence: the run's raw
`m4-carrier-probe-evidence.json`, byte for byte, in
`examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-d/` with its
SHA-256 in `manifest.json`; replayed by
`tests/integration/m4-carrier-status-path.test.ts` (9 tests, the artifact
checked by hash before use).

| Probe | Result |
| --- | --- |
| `kubectl annotate` on the main resource, carrier set to `m4-forged-main` | **denied** by `protected.enforcer.changesafe.dev`: "no AuthorizationGrant was attached to this request". Version and carrier unchanged |
| merge patch to `deployments/web/status` setting the carrier to `m4-forged-status` | **admitted.** Exit 0; resourceVersion 722 to 772; the object's carrier is now `m4-forged-status`, replacing the real grant it held |
| merge patch to the status subresource also setting `spec.replicas: 9` and a label | exit 0, "patched (no change)": replicas stayed 4, the label was not set, the version did not move |

| # | Prediction | Observed |
| --- | --- | --- |
| H9a | holds (medium, about 60 percent) | **holds.** The carrier is writable outside the enforcer, in the protected tier as deployed, by a write to `deployments/status` |
| H9b | holds (high) | **holds** |
| H9c | holds (high) | **holds.** The status strategy reset the spec and the label; only the annotation got through |
| H9d | holds if H9a holds (medium-high) | **not decided by this run.** The run's audit policy listed `deployments` and not `deployments/status`, so the status writes are absent from its audit evidence. That the webhook was not called is inferred, not observed: the same request with no grant attached is denied on the main resource, and the status requests succeeded. The harness's audit policy now lists the subresource, and a second run settles it (below) |

## Findings the predictions did not cover

1. **The probe replaced the real carrier.** The object held grant 1's
   encoded carrier (a signed grant); the status write overwrote it with an
   arbitrary string. The API server validates nothing about the value, so
   forging includes erasing the carrier a legitimate write left.
2. **The experiment's own evidence pipeline had the same blind spot as the
   enforcer.** Both matched `deployments` and not `deployments/status`.
   The audit policy is a second place where a subresource is a different
   resource name, and it hid the very requests under test.
3. **The enforcer annotates nothing when it cannot read a grant.** The
   denied main-resource request carries no `grant-id` annotation, as P1
   was written, so that denial is unattributed in the audit log.
4. **A status write cannot create the target state, only re-attribute it.**
   This bounds the harm and shows what a repair needs.

## What this does to experiment 07's contract

Experiment 07 assumed, for the protected tier, that nothing outside the
enforcer could set the carrier. H9a falsifies that for the tier as
deployed. The model gains one history, in which another grant legitimately
stores the target after this admission and a status write then
re-attributes it to this grant (opt-in, so 07's counts are unchanged):

| Contract | Protected tier, complete watch, exact prior (2,880) | Whole protected grid (43,200) |
| --- | --- | --- |
| v2a (the registered repair) | **96 unsound** | 768 unsound |
| v2b (carrier-keyed) | **192 unsound** | 1,536 unsound |
| v2c (carrier and transition in one event) | **0 unsound**, definite on 2,208 | **0 unsound**, definite on 19,974 |

Each unsound row is a truthful `rejected` read as `stored`: the carrier was
re-attributed on a state another grant stored. **v2c** is the observation
that follows from the probe: a genuine admitted write changes the spec and
sets the annotation in one event, and a status write can only set the
annotation on a state that is already there, so a first carrier event
without the state transition is not the grant's write. It is **post hoc**
(written after the probe, checked against the enumeration it was designed
for) and is a proposal, not a result. It costs definite verdicts (a no-op
target has no transition to see, so presence there is `unknown`), and a
forged carrier on a no-op target is indistinguishable from a genuine one
under all three.

## What this changes in the claims

- The carrier is **not unforgeable in the protected tier as deployed**
  against a principal that can update `deployments/status`. Experiment
  07's soundness holds only with that path closed or with v2c's rule.
- Two mitigations follow, and neither is made here (R12): add
  `deployments/status` (and the other kinds' subresources) to the routing
  guard's rules so annotation changes there are denied in protected
  namespaces, or register the webhook for the subresource. The first is a
  `ValidatingAdmissionPolicy` change in `routing-guards.yaml`.
- This is the first loop finding about **shipped** behavior. It opens a
  `CS-ADV` entry's worth of detail (below); it is not entered in
  `docs/ADVERSARIAL_FINDINGS.md` by this change because that edit is the
  owner's to take (R12).

## What remains unsupported

- The probe uses cluster-admin credentials, which can always do this. It
  shows the API server's behavior for the subresource, not that an
  ordinary principal holds `update` on `deployments/status`; RBAC for the
  subresource is not examined. Controllers and cluster administrators do
  hold it by default, so the set of principals is not empty.
- One Kubernetes version, one kind. StatefulSet, DaemonSet and Service
  strategies differ and are not probed.
- v2c's soundness is over the model, with the model's one forgery
  history; other re-attribution histories are not enumerated.

## Candidate adversarial finding (for the owner to enter)

```
Finding CS-ADV-NNN (proposed)
Hypothesis        The grant carrier annotation is set only by an admission the
                  enforcer answered ALLOW for, in a protected namespace.
Attack surface    PATCH/UPDATE of deployments/{name}/status, which the webhook
                  and the routing guards do not match.
Method            kubectl patch --subresource=status --type=merge with a
                  metadata.annotations entry for changesafe.dev/grant.
Expected          The write is denied, or the annotation is ignored.
Observed          Admitted; the annotation persisted; the legitimate carrier
                  was replaced; spec and labels were not changed.
Severity          Medium: re-attribution of a stored state across grants with
                  the same target; cannot create the target state.
Root cause        Subresources are separate admission targets and were not
                  registered; the status strategy does not reset annotations.
Fix (proposed)    Deny annotation changes on */status in protected namespaces
                  (routing-guards.yaml), or add the subresource to the webhook.
Remaining         RBAC for the subresource; other kinds; whether a controller
uncertainty       ever writes this annotation legitimately (none expected).
```

## Next question

> **Which of the two mitigations closes the path in the live tier, and does
> v2c's rule survive the other re-attribution histories?** Neither is run
> here: the first is a routing-guard change that is the owner's to adopt,
> and a re-run of this probe against it is the next live experiment.
