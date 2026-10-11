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

Harness: `tests/integration/m4-contract-enumeration.test.ts` (10 tests).
The enumeration is 288 protected-tier histories (and 192 more that need the
default tier) under 6 audit edits, 4 stream coverages and 3 prior
knowledges, scored for three contracts. Counts below are exact, from the
committed test.

**Scope A: protected tier, complete watch, exact prior, 1,728 evaluations.**

| Contract | Definite | Unsound | Unknown |
| --- | --- | --- | --- |
| v1 (01 to 06 composed) | 1,504 | **112** | 224 |
| v2a (the pre-registered repair) | 1,392 | **0** | 336 |
| v2b (carrier-keyed) | 1,728 | **0** | 0 |

| # | Prediction | Observed |
| --- | --- | --- |
| H7a | holds (medium): v1 unsound where T equals P | **holds.** 80 of the 112 unsound rows are no-op targets. Mechanism: every state hashes to the target, so "a target state without this grant's carrier" is always present and a truthful `rejected` is read as stored |
| H7b | holds (medium-high): a truthful `rejected` contradicted when another grant produced the same target | **holds, with the timing corrected.** The other 32 rows need another grant to have stored the target *after* this admission. With an exact prior, an *earlier* grant's write is outside the window and is harmless |
| H7c | holds (medium): a lower-bound prior adds unsound histories | **holds.** 152 unsound against 112, 40 added. They come from events before the admission: another grant's earlier write, or, for a no-op target, the status-only events that preceded it |
| H7d | holds (medium): after the repair, no unsound definite verdict | **holds, more strongly than registered.** v2a and v2b are sound in the protected tier for every prior, every coverage and every audit edit (the full 288 x 6 x 4 x 3 grid, 20,736 evaluations each) |
| H7e | holds (high): with a writer-controlled carrier, "stored" cannot be made sound | **holds.** In the default tier, assuming the carrier unforgeable gives 192 unsound rows, every one a copied carrier on a truthful `rejected`. Not assuming it, v2a and v2b have no unsound row and are definite on 1,200 of 2,880 |

**Every one of v1's 112 unsound verdicts in Scope A is produced by one
rule**, the one that reads a target state without this grant's carrier as
contradicting a `rejected` claim. It is the rule written into the
experiment 05 contract before review corrected it (the corrected 05
observer returns `target_state_unattributed`). The other wrong verdicts of
v1 appear only once the audit event is the answer: the audit-fallback
rules produce 528 more unsound rows across all coverages (exact prior),
which is experiment 04's result at scale.

## Findings the predictions did not cover

1. **The carrier-keyed contract is the stronger repair.** v2b returns a
   definite and correct verdict on every Scope A history. Its rule is one
   sentence: in a complete window that covers the admission, `stored` iff
   an event carries this grant's id. The pre-registered v2a, which treats
   any carrier-less target state as unknown, is sound but gives up a
   fifth of the cases for nothing. The cost of v2b is entirely the
   unforgeable-carrier precondition, which v2a also needs for `stored`.
2. **The contract never needs the audit event.** v2a and v2b give the same
   verdict under every audit edit, because neither reads it. Its only role
   in the whole design is as a hint for where to look. That the audit
   pipeline can lie therefore costs the contract nothing, but it also
   means a deployment without a watch or replay has no sound definite
   verdict at all (every coverage but a complete one is `unknown` for
   absence).
3. **Presence survives every coverage; absence needs all three of:** a
   stream that began at or before the prior version, one that ended
   cleanly at the object's version at close, and a prior that is exact or
   a lower bound. The enumeration shows each missing piece moves
   `rejected` to `unknown`, never to a wrong verdict.
4. **A no-op grant is the case an approver would not expect.** The grant
   carries both hashes, so T equal to P is known to the observer. v2b
   handles it without a special case because the carrier annotation
   changes the object even when the spec does not. v1's hash-only
   reasoning has nothing to say about it.

## What the result says about the architecture

1. **The observation contract can be stated in two lines** and it never
   looks at who wrote what except through one field the enforcer controls.
   That is the case for P3 (the exact prior), for P4 (verdicts name their
   source, here only `watch`), and for the carrier annotation as the one
   attribution mechanism, with its precondition written next to it.
2. **The precondition is the whole guarantee.** In the protected tier it
   follows from the webhook's coverage and a fail-closed policy
   ([M2](M2_CLOSEOUT.md)); outside it nothing here is sound. A contract
   that accepts the carrier without the tier is unsound by 192 rows in
   this model.
3. **Absence of a verdict is a first-class output.** With the audit event
   out of the contract, the unknown fraction is driven by observation
   coverage, which an operator controls, and not by an adversary.

## What remains unsupported

- This is a model of the evidence, built from what experiments 03 to 06
  saw. A history it omits is invisible to it, and one it includes might not
  be producible by a real API server.
- Hash equality and the grant's signature are abstract. The carrier's
  unforgeability is a *precondition*, assumed in the protected tier and
  never established here; experiment 05 observed only that no write in its
  runs carried a consumed grant.
- The model has one object and two grants. Several objects in one
  admission, namespace deletion, finalizers and garbage collection are not
  modeled.
- "No unsound verdict found" is not a proof. The enumeration is bounded by
  the dimensions listed.

## Next question

> **Does the structure the contract rests on (an incarnation identity, a
> monotonic version, and a field only the authorizing boundary can set)
> exist in a domain that is not Kubernetes, and does the artifact
> ChangeSafe ingests there carry them?**

Terraform is the nearest test: a state file has a lineage and a serial,
and ChangeSafe's input there is `terraform show -json`, which is a
different artifact.
