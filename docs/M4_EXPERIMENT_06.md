# Can an observer replay history from the admission's prior resourceVersion, and what does it get when it cannot?

Status: **pre-registered 2026-10-11, before the harness was written.** The
hypotheses and predictions below were committed first. The Results section
is added afterward, and the predictions are not edited.

The question comes from [experiment 05](M4_EXPERIMENT_05.md)'s limit: a
watch that is started late or interrupted misses events. 04 proposed P3,
recording the admission's `oldObject.metadata.resourceVersion`. This
iteration asks what that version is worth as a **resume point**: if the
observer was not watching, can it ask the API server to replay what
happened since admission, and what does the API server say when it cannot?

Decision filter: A yes (an after-the-fact observation that does not depend
on having been present); B yes (watch cache, compaction, 410 Gone,
resourceVersion `0` semantics); C yes; D yes. P3 would give the first
evidence that is not a verdict about the write but a *cursor into the
API server's own history*, which no current ChangeSafe abstraction models.

## Setup

After the M4 steps, the kind harness issues four short, bounded watches
and one list against the demo Deployment, each answered by the same API
server as the live watch in experiment 05:

| Request | `resourceVersion` | Purpose |
| --- | --- | --- |
| replay | the version read just before step 1 (what P3 would record as the admission's prior) | H6a, H6d |
| ancient | `1` | H6b |
| any | `0` | H6c |
| list | the prior version, `resourceVersionMatch=NotOlderThan` | H6e |

Every request has `timeoutSeconds` small enough to end on its own. The
prior version is read from the Deployment before the step-1 write rather
than taken from the enforcer, which does not record it today; for a
single UPDATE with no write in between, the two are the same object
version, and the harness records the read.

## Setup amendment (before any experiment 06 result)

[Experiment 05's live evidence](M4_EXPERIMENT_05.md#findings-the-predictions-did-not-cover)
showed the read taken before step 1 (616) is **not** the version the real
admission saw: three status-only events landed first, and the dry-run's
response carried 684. The setup above called the 616 read "what P3 would
record", which the evidence contradicts. The harness now issues two
replays: from the read before step 1 as registered (`replay`), and from
the version the annotated dry-run's response carried
(`replay-prior`), which stands in for a recorded `oldObject` version.
That equivalence is a stand-in, not an observation of the enforcer's own
input. One hypothesis is added, before any 06 result:

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H6f | Replay from the dry-run's version delivers the stored write's event and the later status-only events, and none of the events at or before that version; replay from the earlier read also delivers the three status-only events between them | holds | high: a watch delivers events strictly newer than the requested version |

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H6a | Replay from the prior version delivers the same stored-write event as the live watch of 05: same resourceVersion, same enforcer object hash, same carrier grant id | holds | medium-high: within the watch cache, replay is the documented behavior |
| H6b | A request for version `1` is answered with an explicit 410 Gone / "too old resource version" status, not with silence or an empty stream | holds | high |
| H6c | `resourceVersion=0` delivers a synthetic ADDED event of the current state and **no history**, so an observer using it sees only the end state | holds | high: documented semantics |
| H6d | The replay holds no event naming grant 2 and none matching grant 2's target hash | holds | high |
| H6e | A list at `NotOlderThan` the prior version returns the current object with its current version, i.e. it adds nothing a plain read did not | holds | high |

**What would count as a surprising result.** If H6a fails, a P3-style
cursor is not enough to reconstruct history even in the best case, and
the watch of 05 can only ever be a live observer. If H6b returns an
ordinary empty or ADDED stream for version `1`, an observer could mistake
"the history is gone" for "nothing happened", the same kind of overclaim
this project has been removing from verdict vocabularies.

## Limits stated in advance

- The retention horizon is not measured: the run is minutes long, and
  etcd compaction and watch-cache capacity act on a longer clock and on
  write volume. 410 for a very old version is expected, but where the
  boundary sits is not tested here.
- Replay is evidence from the API server about its own history, exactly
  as trustworthy as a read. It does not show who wrote a version.
- The prior version comes from a read, not from a recorded
  `oldObject`. Whether the two agree under concurrent writers is not
  tested.

## Results

Run: [CI 38167496300](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38167496300),
commit `b06f33e`, all seven jobs passed. Evidence: the run's raw
artifacts, byte for byte, in
`examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-b/` with their
SHA-256 values in `manifest.json` (replay `de4a6f5a…58ad7`, watch
`963424c7…af97`); the tests check each file against its hash before
using it. Replayed offline by
`tests/integration/m4-replay-observer.test.ts` (16 tests).

In this run the read before step 1 (618) **equalled** the dry-run's
version (618). In experiment 05's run they differed (616 against 684). So
the two replays are identical here, and the earlier read is a stand-in
that happens to coincide in some runs and not others.

| Request | Version asked | Answered with |
| --- | --- | --- |
| `replay`, `replay-prior` | 618 | 8 MODIFIED events, rv 672 to 714, identical to the run's live watch |
| `ancient` | 1 | 12 events: ADDED 601 (the object's creation), then 604, 610, 618, then the same 8. **No error** |
| `any` | 0 | one synthetic ADDED at the current version, 714 |
| `list`, NotOlderThan 618 | 618 | the object at 714, in a list whose own version is 754 |

| # | Prediction | Observed |
| --- | --- | --- |
| H6a | holds (medium-high) | **holds.** Same versions, same enforcer hashes, same carrier ids as the live watch |
| H6b | holds (high) | **refuted.** Version 1 was not answered with 410 or an ERROR event. The server delivered the whole history it retained, from the object's creation. The cluster was minutes old, so nothing had been compacted; the boundary where 410 starts was not reached |
| H6c | holds (high) | **holds.** Version 0 delivers the current state and no history |
| H6d | holds (high) | **holds.** No replayed event names or matches grant 2 |
| H6e | holds (high) | **holds.** The list returns the current object; its collection version (754) is not the object's (714) |
| H6f | holds (high) | **half exercised.** A replay delivers only events strictly newer than the version asked for: 618 is absent from the replays and present in `ancient`. The other half, that the earlier read adds status-only events, was not exercised because the two versions coincided |

## Findings the predictions did not cover

1. **Asking for an old version is not a probe for retention.** The
   prediction that version 1 would return an explicit 410 was wrong for a
   young cluster: the server answered with everything it held. An
   observer cannot treat "no error" as "the history reaches back to the
   admission". Coverage has to come from the replay's own start (the
   version asked for is at or before the admission's) and its end (below).
2. **The list is the completeness marker.** The replay's last event (714)
   equals the object's version in a read taken after it. When they are
   equal nothing newer was missed, and that is what lets absence
   (grant 2) count. The list's own version (754) must not be used: it is
   the collection's, and it moves when any other object does.
3. **A request for version 0 looks like a replay and is not one.** It
   returns an event of the right shape, the current state. A contract
   that accepts any stream with the right event type would read the end
   state as the whole history.

## Corrections after internal review (round 1)

Seven findings in the first round, all verified; the five listed change a
claim (the other two were a count mismatch in this section and a wording
fix). Round 2 follows this list.

- **Presence needs the carrier and a write.** The first observer matched
  on the object hash alone, so a DELETED event, or a state with another
  writer's carrier, read as "holds target with carrier". It now requires
  a non-DELETED event whose carrier names the grant, and otherwise
  returns `replay_holds_target_without_carrier`.
- **kubectl's refusal was indistinguishable from an empty history.** A
  410 arrives as stderr text. The summary now keeps the text and adds an
  explicit ERROR status row, and the observer treats any non-event
  output as `unknown_history_unavailable`.
- **The dry-run lookup was not keyed on the object.** It now requires the
  demo Deployment's own namespace, name and verb.
- **A run-specific coincidence was asserted as a contract.** That the two
  replays matched only held because the two versions were equal in this
  run; the test now asserts the relation.
- **The fixture's hashes were not checkable.** The derived fixture is
  replaced by the raw artifacts and a manifest.

## Corrections after internal review (round 2)

Eight findings.

- **The observer was not per-grant (fix).** It read grant 1's version for
  every grant. It now takes the admission version as input; grant 2's is a
  lower bound (grant 1's stored version), with what a lower bound does
  and does not make safe stated in the test.
- **"Cursor is enough" overclaimed (fix).** See architecture point 1.
- **A conditional assertion passed vacuously (fix).** The relation
  between the two replays is now asserted unconditionally, derived from
  the full retained history.
- **The dry-run lookup was not tied to the grant (fix).** The script takes
  the grant id.
- **The completeness marker was not taken with the replay (fix).** The
  harness records the object's version just before and after each
  request.
- **A refused request printed "0 event(s)" (fix).** It prints UNAVAILABLE.
- **A finding count that did not reconcile (fix).** Round 1's section now
  says which five of its seven findings changed a claim.
- **A status-only event past the prior version as "a write" (pushed
  back).** Carrier G cannot exist on the object before G's consumption, so
  no event can carry it before the admission, and the observer requires
  the carrier, not the hash alone.

## What the result says about the architecture

1. **A replay from a version at or before the write returns the write.**
   A replay from the dry-run's version reproduced the live watch exactly,
   with no observer present at the time, so an absent observer can ask
   the API server what happened since. That is a statement about the
   API server's own history and is close to true by construction: a
   replay and a live watch are the same server's account. What was *not*
   tested is a recorded `oldObject` version; the dry-run's response stood
   in for it, and in this run it also coincided with the read before
   step 1. Whether P3's value would do as well is the open part.
2. **The stand-in for P3 is unreliable.** Across three live runs the read
   before step 1 equalled the admission's version once (this run) and was
   older twice (experiment 05's runs). An older start is safe for
   coverage and wrong as a description of what the enforcer saw. That an
   older start adds the intervening events is the unexercised half of
   H6f in this run, and rests on experiment 05's run. Recording
   `oldObject` in use-state removes the guess.
3. **The retention horizon is the open boundary.** Everything above
   rests on the server still holding the events. Compaction and the
   watch cache's capacity decide that, on a clock and a write volume this
   run did not reach.

## What remains unsupported

- The point at which an old version stops being answered with history and
  starts being answered with 410 (or an ERROR event) was not reached.
- One run, one Kubernetes version, the protected tier, a minutes-old
  cluster with a handful of writes.
- Replay is the API server's own account of itself, as a read is, and
  does not show who wrote a version.
- The version asked for came from a read and a dry-run response, not
  from a recorded `oldObject`.

## Next question

> **How far back does the API server answer a replay, and what does it
> say at the edge: can an observer distinguish "history reaches the
> admission" from "history was compacted" from "no events"?**

That needs a clock and a write volume this harness does not have, so it
is not scheduled as the next experiment. A cheaper neighbouring question
is whether the evidence the project has collected can be stated as one
contract in which no verdict overclaims, which is where the loop goes
next.
