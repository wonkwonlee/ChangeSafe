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

Pending the CI run.
