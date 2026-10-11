# What can a party who controls the audit pipeline make an E2 observation say?

Status: **pre-registered 2026-10-11, before the harness was written; results recorded the same day.** The
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

Harness: `tests/integration/m4-audit-pipeline-adversary.test.ts` (10 tests).
Baseline: 03's real events, plus the real stored object, trimmed into
`examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-stored-object.json`
with its provenance. Unaltered, both contracts agree with what the cluster
did: grant 1 `audit_reports_stored`, grant 2 `audit_reports_rejected`.

| Attack | Audit alone | Audit + read | Truth |
| --- | --- | --- | --- |
| H4a: drop the consuming event | `unknown_no_event` | same | stored / rejected |
| H4b: inject a second event for the consumed admission | `unknown_conflicting_events` | same | rejected |
| Alter the stored object (replicas 9) | `audit_inconsistent_with_grant` | same | stored |
| H4c: flip grant 2's 500 to 200 | `audit_reports_stored` ✗ | `contradicted_by_read` | rejected |
| H4c, enforcer has no recorded prior version | `audit_reports_stored` ✗ | `audit_reports_stored` ✗ | rejected |
| H4d: fabricate a 200 with the grant's exact target object, nothing stored since | `audit_reports_stored` ✗ | `contradicted_by_read` | rejected (modeled) |
| H4e: same, a later write landed (read rv 900), forged rv 760 | `audit_reports_stored` ✗ | `audit_reports_stored` ✗ | rejected (modeled) |
| H4e: same, forged rv 950 | `audit_reports_stored` ✗ | `contradicted_by_read` | rejected (modeled) |
| Reverse: rewrite grant 1's real 200 as 500 | `audit_reports_rejected` ✗ | `audit_reports_rejected` ✗ with a version-based read; `contradicted_by_read` with a carrier-aware read (see correction) | stored |

✗ marks a wrong verdict. "Modeled" means the truth comes from a supposed
history built on real objects, not from the run itself. The H4d forgery
uses the real stored object, which hashes to the real grant: that is the
object any forger can rebuild from the grant-bearing request.

| # | Prediction | Observed |
| --- | --- | --- |
| H4a | holds | **holds** |
| H4b | holds | **holds** (a design choice: the contract refuses to choose) |
| H4c | holds as an attack | **holds.** The read catches it **only if the enforcer recorded the prior version, which it does not today** |
| H4d | holds as an attack | **holds.** Hash and uid checks against the grant pass, because the forger copies the grant's own target |
| H4e | holds | **holds.** After any later write, only a "stored" version newer than the current read is caught |

**Unpredicted: the reverse attack is not caught by a version-based read.**
Rewriting a stored write's 200 as a 500 turns it into "rejected" under both
contracts. A read newer than admission is what a rejected write followed by
any other write would also produce. *(Corrected after review: this holds
for a version-based read only; see "Correction after review" below. The
first draft said "never caught", which overgeneralized.)*

## What the result says about the architecture

1. **Audit evidence is the pipeline operator's statement.** Checking the
   stored object against the signed grant proves the event names the
   authorized object, not that the API server stored it. This is the same
   line invariant 11 draws for receipts: integrity is not authorship. A
   contract that uses audit evidence should say so in its verdict
   (`audit_reports_*`), never `stored` or `rejected` alone.
2. **A version-based read helps in one direction only.** It can
   contradict a false "stored" when nothing has been written since
   admission, or when the claimed version is newer than the current one.
   It does not contradict a false "rejected". A read that holds the
   grant's exact target state and carries the grant's id can, but only
   where the tier makes that carrier unforgeable; see the correction.
3. **The prior version is the cheapest missing evidence.** Without
   `oldObject.metadata.resourceVersion` recorded at admission, even the
   simplest flip (H4c) cannot be caught. The enforcer sees that version and
   does not keep it.

## Proposals (not adopted; owner decision per R12)

- **P3.** The use-state records `oldObject.metadata.resourceVersion`
  beside the consuming admission uid. It is a read-only addition that the
  enforcer already receives, and it is what makes H4c and H4d detectable.
- **P4.** Any observation contract proposed for core names its evidence
  source in every verdict. Audit-derived verdicts are reports by the
  pipeline operator, and only a read can contradict them.

## Correction after review (2026-10-11)

An internal code review of PR #80 found ten issues. The ones that change
this note's claims:

1. **"Never caught" overgeneralized.** The harness's `auditPlusRead` only
   cross-checked "stored" verdicts, so the reverse attack going uncaught
   was a property of that contract, not of reads. The harness now has a
   carrier-aware rule: a read whose enforcer hash equals the grant's
   target, whose uid matches, and whose carrier annotation names the grant
   contradicts "rejected" (`contradicted_by_read`). The rule is sound only
   where nothing outside the enforcer's webhook can set the carrier. The
   harness takes that as an explicit option
   (`carrierWritableOutsideEnforcer`) and shows both outcomes: caught when
   the carrier is unforgeable, and a **false contradiction of a true
   rejection** when another writer can reproduce the target state and
   copy the carrier (experiment 01 showed the annotation is
   client-writable). Whether the protected tier makes the carrier
   unforgeable is exactly what [experiment 05](M4_EXPERIMENT_05.md)
   tests live.
2. **Status updates move the version.** A controller's status write bumps
   `resourceVersion` without changing spec, so the "nothing stored since"
   equality check abstains more often than the table implied: a flipped
   500 stands once any status update lands. This is a missed catch, never
   a wrong one; the harness records it as a test. The live watch in
   experiment 05 measured it: three status-only events arrived between
   the version read before the write and the write itself.
3. **The prior version's provenance.** `priorResourceVersion: 695` came
   from the dry-run's response, not from the consuming admission's
   `oldObject`. They would differ if a write landed between the two
   requests. The fixture states its source; the equivalence is unverified.
4. **Harness fixes that do not change a verdict in the table:** redelivery
   of an identical event no longer degrades a true verdict to unknown
   (events collapse by content), while the same audit id with different
   content is a conflict; only 2xx on a write verb maps to "stored",
   4xx and 5xx to "rejected", and anything else to
   `unknown_unrecognized_event`; dry-run detection is
   spelling-insensitive; the stored object is tied to its audit event by
   audit id, not by a hard-coded prefix; the vocabulary test now checks
   verdicts the contracts actually returned, and every verdict in the
   vocabulary is exercised by some test.

## What remains unsupported

- No ChangeSafe evidence attests E2 against this adversary. With P3, a read
  can catch false "stored" claims in the "nothing stored since" case;
  nothing catches a hidden write.
- H4d, H4e and the reverse attack's truths are modeled histories over real
  objects. Grant 2's read after the run (rv 710) is modeled too: the run
  did not read the resource back after the rejection.
- Out-of-scope adversaries (a compromised API server, a compromised
  enforcer, collusion with the executor) are untested.

## Next question

> **In a protected namespace, where every update needs a fresh single-use
> grant, does a watch from an independent observer settle stored vs
> rejected for the consuming admission, including the hidden-write case,
> and what is left when the watch is interrupted?**

The reason to expect it might work: in the protected tier, a stored version
carrying grant G's annotation can only come from G's consuming admission,
because any reuse is denied and any other write must carry its own grant.
That claim is untested. Experiment 01 showed annotations can be copied, and
whether the tier really forces the carrier to change on every write is
exactly what the next iteration would have to attack.
