# Does a watch from an independent observer settle stored versus rejected for the consuming admission?

Status: **pre-registered 2026-10-11, before the harness was written.** The
hypotheses and predictions below were committed first. The Results section
is added afterward, and the predictions are not edited.

The question comes from [experiment 04](M4_EXPERIMENT_04.md)'s recorded
next question. 04 found that audit evidence is the pipeline operator's
statement, that an independent read can contradict a false "stored" only
when nothing was stored since admission, and that a stored write hidden
behind a 500 is never caught. A watch is an event stream, not a snapshot,
so it might not share the read's blind spot.

Decision filter: A yes (is there an E2 observation that survives the
audit-pipeline adversary); B yes (watch semantics, bookmarks, what an
event does and does not carry); C yes; D yes. A watch is evidence from the
same API server as a read but with history, and no current abstraction
distinguishes a point observation from a history.

## What changes in the setup

The kind harness starts one watch on the demo Deployment **before** the
step-1 write and keeps it open through every M4 step. The raw watch API is
used, so the output is newline-delimited events:

```
GET /apis/apps/v1/namespaces/changesafe-protected-demo/deployments
    ?watch=1&fieldSelector=metadata.name=web&resourceVersion=<read before step 1>
```

Nothing else about the live run changes. The observer is the harness's
own credentials, so this tests the evidence, not an independent trust
boundary: a watch is exactly as trustworthy as the API server that
answers it, the same as a read. An adversary who controls the observer's
connection to the API server (a proxy, a compromised sink) is outside
this attack model.

## Evidence held independently of the audit pipeline

As in 04: the signed grant, the enforcer's use-state, an independent
read. New here: the watch's event stream, summarized by
`m4-watch-summary.mjs` into per-event facts (type, resourceVersion, uid,
replicas, the grant id the carrier annotation names, and the enforcer
object hash).

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H5a | The watch delivers a MODIFIED event for grant 1's stored write whose enforcer object hash equals the grant's `objectSha256`, whose uid equals `resourceUid`, whose carrier annotation names grant 1, and whose resourceVersion equals the audit event's stored version | holds | medium: events for the write and a following status update might be delivered as one |
| H5b | No event carries grant 2's id or a hash equal to grant 2's target: the watch shows the rejected write as absent | holds | high |
| H5c | Some events leave the enforcer hash unchanged while advancing resourceVersion (status-only updates by the Deployment controller), so a version advance alone is not evidence that the admitted write was stored | holds | medium: depends on whether the rollout updates status inside the watch window |
| H5d | Rewriting grant 1's audit 200 as a 500 (04's reverse attack, which no read catches) is contradicted by the watch, which still holds the stored event | holds | high, given H5a |
| H5e | A fabricated audit 200 for grant 2 (04's H4d) is contradicted by the watch, which holds no event for grant 2 | holds | high, given H5b |

**What would count as a surprising result.** If H5a fails because the
write's event is absent or merged with another, a watch cannot settle
stored versus rejected without more machinery, and the observer would need
a list-and-diff step. If H5c fails, a version advance would be strong
evidence of a spec write in this tier, which would simplify the contract.

## Limits stated in advance

- One run, one Kubernetes version, one namespace tier.
- A watch that is interrupted or started late misses events. That is
  experiment 06's question and is not claimed here.
- A watch shows that a stored version existed. It does not show who wrote
  it: the carrier annotation is client-writable, and in this tier a
  carried grant that was not consumed for that object would have been
  denied, but that rests on the webhook answering.

## Results

Run: [CI 38166778773](https://github.com/wonkwonlee/ChangeSafe/actions/runs/38166778773),
commit `e0a9ffd`, all seven jobs passed (this run also carried #79's
round-1 setup checks, which passed: the downstream webhook named the
rejection and the enforcer's use-state held the consumed grant). Evidence:
`examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-watch-events.json`
(raw artifact SHA-256 `09bdc2bb…c6db2`), replayed offline by
`tests/integration/m4-watch-observer.test.ts` (12 tests). The watch opened
at resourceVersion 616 and delivered 8 events, all Deployment, no
bookmarks.

| rv | replicas | observedGeneration | carrier names | hash changed | matches a grant |
| --- | --- | --- | --- | --- | --- |
| 673 | 3 | 1 | — | (first) | — |
| 678 | 3 | 1 | — | no | — |
| 684 | 3 | 1 | — | no | — |
| **703** | **4** | 1 | grant 1 | **yes** | **grant 1** |
| 708 | 4 | 2 | grant 1 | no | grant 1 |
| 713 | 4 | 2 | grant 1 | no | grant 1 |
| 716 | 4 | 2 | grant 1 | no | grant 1 |
| 726 | 4 | 2 | grant 1 | no | grant 1 |

The audit's consuming event for grant 1 stored version 703, and for grant 2
ended in a 500 with no stored object. The enforcer's use-state named one
consumer for each.

| # | Prediction | Observed |
| --- | --- | --- |
| H5a | holds (medium) | **holds.** Exactly one event changed the hash to grant 1's target: rv 703, uid equal to the grant's `resourceUid`, carrier naming grant 1, version equal to the audit's stored version. It was not merged with a status update |
| H5b | holds | **holds.** No event names grant 2 or matches its target hash |
| H5c | holds (medium) | **holds, more than predicted.** Two status-only events (678, 684) landed **before** the write and four (708 to 726) after |
| H5d | holds | **holds** on the recorded evidence: rewriting grant 1's 200 as a 500 is contradicted, because the stream holds the target state |
| H5e | holds | **holds:** a flipped or fabricated "stored" claim for grant 2 is contradicted, because the stream holds no event for it |

Offline scoring against 04's attacks, with the watch as observer:

| Claim | Watch | Reconciled |
| --- | --- | --- |
| grant 1 stored (truthful) | holds target, carrier | `agrees_stored` |
| grant 2 rejected (truthful) | no target state | `agrees_rejected` |
| grant 1 "rejected" (04's reverse attack) | holds target, carrier | `claim_contradicted_by_watch` |
| grant 2 "stored" (04's flip or fabrication) | no target state | `claim_contradicted_by_watch` |
| any claim, stream began after admission | not covered | `claim_unchecked_watch_unknown` |
| any claim, stream out of order | discontinuous | `claim_unchecked_watch_unknown` |
| grant 1 "stored", target without carrier | target, no carrier | `claim_stored_state_unattributed` |

## Findings the predictions did not cover

1. **The read before the write is not the admission's prior version.**
   The watch opened at 616, from a read just before step 1. The dry-run's
   response, and so the version the real admission's `oldObject` carried,
   was 684, after three status-only events. Experiment 06 as
   pre-registered replays from "the version read before step 1" and
   described it as what P3 would record. This evidence shows that is not
   so; the amendment is recorded in
   [experiment 06](M4_EXPERIMENT_06.md).
2. **Events naming a grant are not writes.** Five events carry grant 1's
   carrier; one is the write. The status-only events keep the annotation.
   The observer must use the first event that changes the hash to the
   target with a version newer than the admission's, not a count of
   events naming the grant.
3. **The carrier question 04 left open is answered by the tier, not by
   the watch.** This run made no attempt to copy a carrier. In the
   protected tier, any write that carries a consumed grant is refused by
   the enforcer ("already exercised"; demo step 2 shows it for a modified
   object), and status writes do not change annotations, so the carrier
   was not forgeable by an ordinary writer here. That rests on the
   webhook covering the write path and answering. A namespace
   deprotected by an administrator, or the default tier's fail-open
   behavior, would not give it, which is why 04's harness takes the
   property as an explicit option.

## What the result says about the architecture

1. **A watch is evidence the audit adversary cannot reach, and closes
   04's hidden-write gap on this evidence.** It is the API server's own
   account, as a read is, with history a read lacks.
2. **Absence is only evidence when the stream provably covers the
   admission.** "No event for grant 2" means rejected only if the stream
   began at or before the admission's version and was continuous. A
   late or gapped stream makes every claim unchecked, which is
   [experiment 06](M4_EXPERIMENT_06.md)'s question.
3. **The observer needs the enforcer's recorded prior version
   (P3).** Without it the observer chooses a start version by a read
   that, as finding 1 shows, can be older than the admission, which is
   safe for coverage but wrong as a description of what P3 would record.

## What remains unsupported

- One run, one Kubernetes version, the protected tier only.
- The watch is the API server's account of itself. A compromised API
  server, or an adversary between the observer and the API server, is
  out of scope; nothing here shows who wrote a version.
- Convergent writes by another actor with the carrier stripped appear as
  `watch_holds_target_without_carrier`. This run produced none; the
  verdict is modeled.
- A watch held open for the whole window assumes the observer was
  present. When it was not, see experiment 06.

## Next question

Experiment 06, already registered: what can an observer recover from the
API server's history when it was not watching, and what does the server
say when it cannot?
