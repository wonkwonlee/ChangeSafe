# Is there a verdict function over the evidence that is never wrong under the attack model, and what is it unknown on?

Status: **pre-registered 2026-10-11, before the enumerator was written.**
The hypotheses, the world model and the predictions below were committed
first. The Results section is added afterward, and the predictions are not
edited.

Experiments 01 to 06 each tested one evidence source against one attack,
and each wrote its own test-local verdict vocabulary. This iteration asks
whether those pieces compose: can one function over the audit event, the
enforcer's use-state, a watch or replay, and a read return a definite
`stored` or `rejected` only when it is true, across a bounded space of
histories and audit edits, and where must it say `unknown`? It is the
project's first exhaustive check of an observation contract, the same
discipline M3 applied to the grant protocol, here in TypeScript over a
model of the evidence rather than in TLA+.

Decision filter: A yes (the question M4 was opened to answer, stated as a
property); B yes (bounded exhaustive checking of a decision function,
soundness versus completeness); C yes; D yes. Counterexamples from this
search cannot be found one at a time by the earlier experiments, because
each fixed the other dimensions.

## World model

One Deployment and one grant G with target state T, admitted against a
prior state P at version v. A history is a choice in each of these
dimensions; the product is enumerated.

| Dimension | Values |
| --- | --- |
| Write by G | stored; rejected by a later stage after ALLOW; not attempted |
| Target relation | T differs from P; T equals P (a no-op) |
| Status-only updates | none; before the write; after the write |
| Later writer | none; restores P; sets T with no carrier; sets T with a copied carrier (only where the carrier is writable) |
| Another grant G2 | none; G2's own write produced T before G's admission and carries G2's id |
| Incarnation | same throughout; deleted and recreated after the write |

Truth is `stored` when G's write persisted at any time, `rejected` when it
was admitted and then rejected, and `not_consumed` when G was never
exercised.

**Evidence the contract may use**, each generated from the history:

- the audit event for the consuming admission (the enforcer's use-state
  names it), subject to an adversary edit: none, drop, flip a code, fabricate
  a stored event, hide a stored write as a rejection, inject a conflicting
  event;
- a watch or replay, either complete (starts at or before the prior
  version and its last event carries the object's version at close), cut
  before the write, cut after it, or started late;
- a read of the object after the history;
- the recorded prior version, either exact (P3) or a lower bound (the read
  before step 1, which experiments 05 and 06 showed is sometimes older).

**Preconditions, varied as a parameter:** whether the carrier annotation
can be set by a writer outside the enforcer's webhook.

## The contract under test

The version 1 contract is the composition of what 01 to 06 each used:
trust a complete watch over the audit event; with no usable watch fall
back to the audit event cross-checked by the read; a target state that
lacks this grant's carrier is not attributed to it. It returns one of
`stored`, `rejected`, `not_consumed`, `unknown`, plus the basis it used.

**Soundness** is: whenever the contract returns `stored` or `rejected`,
it equals the truth, under the stated preconditions. **Completeness** is
not required; the unknown fraction is reported.

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H7a | Under a complete watch, an exact prior version and an unforgeable carrier, the version 1 contract is sound on every history except those where T equals P: a no-op write persists nothing observable, so the contract reads its absence as `rejected` | holds | medium: the no-op case was never constructed in 01 to 06 |
| H7b | The version 1 treatment of "target state without this grant's carrier" contradicts a truthful `rejected` claim when another grant G2 produced the same target T, because the event matches G by hash alone | holds | medium-high: experiment 05's own test lets `matchesGrant` ignore which grant wrote the event |
| H7c | With the prior version known only as a lower bound, more histories become unsound than under an exact version: the event window opens earlier and admits another writer's target event | holds | medium |
| H7d | After repairing H7a and H7b (require T differs from P; attribute `stored` only to an event carrying this grant's id; target-without-carrier is `unknown` for a `rejected` claim), an exhaustive rerun finds no unsound definite verdict under the preconditions, and the unknown fraction is reported | holds | medium: a repair that passes its own enumeration is weak evidence unless the enumeration is varied |
| H7e | With the carrier writable by a writer outside the enforcer, no repair of the contract makes `stored` sound for a stream that shows the target with a carrier, so the contract must say `unknown` there | holds | high |

**What would count as a surprising result.** If H7a finds *no* unsound
history, the no-op case is handled by something already in the contract
and the model is wrong. If H7d finds a counterexample after the repair,
the contract needs more than a repair and the project's claim that a
sound observation contract exists for this tier is in doubt.

## Limits stated in advance

- The enumeration covers the dimensions above and no others. A sound
  result is "no counterexample under this model", never "proven sound".
- The model is of the evidence, not of Kubernetes. Its histories are
  hand-written from what experiments 03 to 06 observed; an event ordering
  the real API server cannot produce would be an invalid history, and a
  real one the model omits would be invisible to it.
- Hash equality and signature checks are abstract, as in M3.

## Results

Pending.
