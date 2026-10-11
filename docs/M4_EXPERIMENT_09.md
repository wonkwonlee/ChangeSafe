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

Pending the CI run.
