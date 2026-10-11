# What can a party who controls the audit pipeline make an E2 observation say?

Status: **pre-registered 2026-10-11, before the harness was written.** The
hypotheses, attack model and predictions below were committed first. The
Results section is added afterward, and the predictions are not edited.

The question comes from [experiment 03](M4_EXPERIMENT_03.md)'s recorded
next question. 03 showed that an audit event, joined to the enforcer's
use-state by admission uid, separates a stored write from a rejected one.
This iteration asks what that evidence is worth against someone who can
edit it.

Decision filter: A yes (whether any E2 evidence survives an adversary who
is not a party to the change); B yes (provenance of an unsigned log; the
gap between integrity checks and authorship); C yes; D yes. ChangeSafe
distinguishes integrity from authorship for receipts (invariant 11), but
it has no position on evidence it neither writes nor signs.

## Attack model

The adversary controls the audit pipeline: the log file, the webhook
backend, or the sink that stores events. They can drop, alter, inject,
duplicate, and reorder events. They can read every event, including the
signed grant carried in a request's annotation. They **cannot** forge an
Ed25519 grant signature, write the enforcer's use-state, or change what the
API server answers to a read.

Out of scope: a compromised API server, a compromised enforcer, and
collusion with the executor. Each would need its own attack model.

## Evidence ChangeSafe holds independently of the pipeline

- **The signed grant:** grant id, resource, `resourceUid`, `objectSha256`.
- **The enforcer's use-state:** grant id → consuming admission uid (P2).
- **An independent read** of the resource from the API server: uid,
  `resourceVersion`, state.
- **The admission's prior version** (`oldObject.metadata.resourceVersion`),
  if the enforcer records it. It does not today; whether it should is part
  of the question.

One fact was checked against [03's live evidence](M4_EXPERIMENT_03.md)
before this note was written. For both 200 responses in that run,
`kubernetesObjectSha256` of the stored object equals the grant's
`objectSha256`, and the stored uid equals `resourceUid`. A genuine "stored"
event can therefore be checked against the grant.

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H4a | With 03's join, **dropping** the consuming event yields `unknown`, never a wrong verdict | holds | high: the join finds nothing to misread |
| H4b | **Injecting** a second event with the consumed admission uid yields `unknown` if the contract refuses to choose between conflicting events | holds | high: a design choice, tested to keep it honest |
| H4c | **Altering** a rejected event's code from 500 to 200, with no stored object (as at `Metadata` audit level), yields a wrong "stored" verdict from audit evidence alone | holds as an attack | high |
| H4d | **Fabricating** a 200 event whose stored object matches the grant (hash and uid, built from the grant the forger can read) passes every check that uses the audit event and the grant alone | holds as an attack | high: the forger knows the target state |
| H4e | An **independent read** with documented version ordering catches H4c and H4d when nothing was stored after admission (the read's version equals the prior version, or is older than the fabricated "stored" version), and cannot catch them once a later write has landed | holds | medium: depends on the enforcer recording the prior version |

If H4c to H4e hold, the result is this: audit evidence, however carefully
joined, is the pipeline operator's statement. A contract may use it only
under a verdict that names that trust, and an independent read can
contradict it only in the "nothing stored since" case.

## Method (planned)

Offline. The baseline is the real stored object from 03's run, trimmed into
a fixture with its provenance. Each attack mutates the 03 evidence as the
attack model allows. Each attack is scored by an audit-only contract and
again by an audit-plus-read contract. Both contracts are test-local.

## Results

Pending.
