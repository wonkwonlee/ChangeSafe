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

Pending the CI run.
