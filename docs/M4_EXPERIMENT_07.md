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

Harness: `tests/integration/m4-evidence-model.ts` (the model and the
contracts) and `tests/integration/m4-contract-enumeration.test.ts` (14
tests). The enumeration is 768 parameter tuples, of which **300 are
distinct worlds** (some parameters do nothing in some combinations: another
grant's earlier write is inert for a no-op target, a restore is inert when
the state did not move). The protected tier is 288 tuples and 168 worlds.
Each is run under 6 audit edits, 5 stream coverages and 3 prior
knowledges. Counts below are of evaluations (a world under one edit,
coverage and prior) and are asserted exactly in the test.

Four contracts are scored:

- **v1**: experiments 01 to 06 composed with experiment 05's rule as first
  written (a target state without this grant's carrier contradicts a
  `rejected` claim). The version before 05's review corrected it.
- **v1c**: the same composition with 05's corrected rule (that state is
  unattributed). This is what the project would actually have run.
- **v2a**: the pre-registered repair: stored only on this grant's carrier,
  a target state without it is unknown, nothing said about a no-op target,
  never a definite verdict from the audit event.
- **v2b**: carrier-keyed: in a complete window that covers the admission,
  `stored` iff an event carries this grant's id, else `rejected`.

**Scope A: protected tier, complete watch, exact prior (1,728
evaluations).**

| Contract | Definite | Unsound | Unknown |
| --- | --- | --- | --- |
| v1 | 1,504 | **112** | 224 |
| v1c | 1,392 | **0** | 336 |
| v2a | 1,056 | **0** | 672 |
| v2b | 1,728 | **0** | 0 |

**Outside scope A, protected tier, exact prior, all five coverages (8,640
evaluations):** v1 is unsound on 984 (the 112's rule 376 times, the audit
fallbacks 608), and **v1c on 608**, all from the audit-fallback rules: the
audit event is the answer once the watch cannot give one, which is
experiment 04's result at scale. v2a and v2b are unsound on none.

| # | Prediction | Observed |
| --- | --- | --- |
| H7a | holds (medium): v1 sound on every history except those where T equals P | **refuted as stated.** 80 of the 112 unsound rows are no-op targets, but the other 32 are outside the registered exception: they need another grant to have stored the target after this admission. A prediction of one cause found two. (An earlier draft of this note scored it "holds" and credited those 32 to H7b; that was a generous reading of a prediction that said "except those where T equals P") |
| H7b | holds (medium-high): a truthful `rejected` is contradicted when another grant produced the same target | **holds, with the timing corrected.** The 32 rows need the other grant's write to come *after* this admission. With an exact prior, an earlier grant's write is outside the window and harmless; it appears only under a lower-bound prior (H7c) |
| H7c | holds (medium): a lower-bound prior adds unsound histories | **holds.** 152 against 112, 40 added, from events that precede the admission: another grant's earlier write, or for a no-op target the status-only events before it |
| H7d | holds (medium): after the repair, no unsound definite verdict | **holds.** v2a and v2b are sound over the whole protected grid (25,920 evaluations each) for every prior, coverage and audit edit. v2b is definite on 13,824 of them and v2a on 10,944 |
| H7e | holds (high): with a writer-controlled carrier, "stored" cannot be made sound | **holds.** In the default tier, assuming the carrier unforgeable gives 192 unsound rows for v2b (96 for v2a, which says nothing about a no-op), each a copied carrier on a truthful `rejected`. Not assuming it, neither has an unsound row, and they are definite on 1,200 (v2b) and 1,152 (v2a) of 2,880 |

**v1's 112 unsound verdicts in scope A all come from one rule**, the one
that reads a target state without this grant's carrier as contradicting a
`rejected` claim. That rule was in experiment 05's first contract and was
removed by 05's review. So the headline is narrower than "01 to 06 composed
are unsound": it is that the *uncorrected* rule is, and that the corrected
composition (v1c) is sound in scope A and unsound only where the audit
event decides, as 04 already showed.

## Findings the predictions did not cover

1. **The carrier-keyed contract is the stronger repair.** v2b returns a
   definite and correct verdict on every scope A history. Its rule is one
   sentence: in a complete window that covers the admission, `stored` iff
   an event carries this grant's id. v2a, which gives up on a no-op target
   and on any carrier-less target state, is sound but unknown on 672 of
   1,728. The cost of v2b is entirely the unforgeable-carrier
   precondition, which v2a also needs for `stored`.
2. **The contract never needs the audit event.** v2a and v2b give the same
   verdict under every audit edit, because neither reads it. That the
   audit pipeline can lie therefore costs the contract nothing, and it
   also means a deployment with no watch or replay has no sound definite
   verdict about absence.
3. **Each missing piece of coverage moves `rejected` to `unknown`, never
   to a wrong verdict.** A stream that began after the admission, was cut
   before or after the write, or ended abnormally, or a prior that is
   unknown, are each tested.
4. **A no-op grant is the case an approver would not expect.** The grant
   carries both hashes, so T equal to P is known to the observer. v2b
   handles it without a special case because the carrier annotation
   changes the object even when the spec does not. v1's hash-only
   reasoning has nothing to say about it.
5. **An interior drop is detected only when the dropped event was last.**
   A stream with the grant's events removed fails the close marker when
   one of them was the final event, and passes it when a later writer's
   event follows. That is the model's stated limit for an adversary on the
   observer's own path, and it is asserted, not hidden.

## What the result says about the architecture

1. **The observation contract can be stated in two lines** and it reads
   nothing the pipeline can edit. That is the case for P3 (the exact
   prior), for P4 (verdicts name their source, here only `watch`), and for
   the carrier annotation as the single attribution mechanism, with its
   precondition written next to it.
2. **The precondition is the whole guarantee.** In the protected tier it
   follows from the webhook's coverage and a fail-closed policy
   ([M2](M2_CLOSEOUT.md)); outside it nothing here is sound. A contract
   that accepts the carrier without the tier is unsound by 192 rows in
   this model.
3. **Absence of a verdict is a first-class output.** With the audit event
   out of the contract, the unknown fraction is driven by observation
   coverage, which an operator controls, not by an adversary.

## What remains unsupported

- **The model makes the contract's premise true by construction.** Every
  stored write emits exactly one carrier event, and the carrier appears
  only through this grant or a stated default-tier copy. v2b's "stored iff
  a carrier event" is then close to a restatement of the model, so "v2b is
  definite everywhere" is a statement about the model. What the model
  adds over experiments 03 to 06 is the interaction of the dimensions, not
  independent evidence that Kubernetes behaves this way.
- A real API server could produce histories the model omits (coalesced
  events, a carrier stripped by the same event that sets it) and the model
  has histories a real one could not.
- Hash equality and the grant's signature are abstract. The carrier's
  unforgeability is a *precondition*, assumed in the protected tier and
  never established here; experiment 05 observed only that no write in its
  runs carried a consumed grant.
- One object and two grants. Several objects in one admission, namespace
  deletion, finalizers and garbage collection are not modeled.
- "No unsound verdict found" is not a proof; the enumeration is bounded by
  the dimensions listed.

## Next question

> **Does the structure the contract rests on (an incarnation identity, a
> monotonic version, and a field only the authorizing boundary can set)
> exist in a domain that is not Kubernetes, and does the artifact
> ChangeSafe ingests there carry them?**

Terraform is the nearest test: a state file has a lineage and a serial,
and ChangeSafe's input there is `terraform show -json`, which is a
different artifact. That is [experiment 08](M4_EXPERIMENT_08.md).
