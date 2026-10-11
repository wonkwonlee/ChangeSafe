# Can a read of stored state be attributed to the request that was admitted?

Status: experiment run 2026-10-11, result recorded, **not merged and not
adopted into core**. Run autonomously at the owner's request as the first
bounded step of [M4](M4_DECISION.md); the owner decides whether its
contract proposal proceeds. No cluster was used: every case is constructed
offline against the production object hash
(`kubernetesObjectSha256`) and runs in
`tests/integration/m4-observation-correlation.test.ts`.

Decision filter: A yes (E1 → E2 is the gap M2/M3 left standing); B yes
(causal attribution versus state equality, incarnation identity, opaque
resource versions); C yes (four reads that look alike and mean different
things); D yes — a fourth role appears that neither `ChangeReceipt` nor
`AuthorizationGrant` names (see "What the result says about the
architecture").

## Question and hypothesis

M3 showed that consumption must precede ALLOW, so a grant is burned even
when the API server later rejects persistence. [M4](M4_DECISION.md) asked
whether a later read-only observation can close that gap.

**H1 (naive correlation):** after ALLOW, reading the resource back and
finding `kubernetesObjectSha256(read) === grant.objectSha256` establishes
that the admitted write persisted (E2).

## Method

A test-local observation contract — `AdmissionEvidence` (what the enforcer
knew at ALLOW: admission uid, grant id, operation, incarnation uid on
UPDATE, target hash) and `Observation` (unavailable, absent, or present
with the raw object) — is correlated two ways: H1, and an `attribute`
function whose verdict set has no member meaning "persisted". The four
paths named in the M4 decision plus two more are built as fixtures and
both functions are run on each. Nothing in the harness is a
re-implementation of production hashing; the hash under test is the one
the enforcer uses.

## Results

| Case | Read shows | H1 | Contract verdict | Why H1 is wrong or unsure |
| --- | --- | --- | --- | --- |
| Recreated incarnation | equal spec, new `metadata.uid` | persisted | `not_this_incarnation` | uid is server-owned and excluded from the hash by design; the object that was admitted no longer exists |
| Convergent re-apply | equal spec, same uid, grant annotation gone | persisted | `state_consistent_unattributed` | another writer (e.g. a reconciler) produced the equal state; nothing ties it to this admission |
| Admitted, persistence rejected | prior spec | not persisted | `unknown_divergent` | correct answer, false certainty — see next row |
| Persisted, then overwritten | prior spec | not persisted | `unknown_divergent` | ~~the read is **byte-identical** to the row above~~ — corrected below: that fixture reused the prior `resourceVersion`, which a stored write cannot leave behind |
| Unavailable or absent read | — | not persisted | `unknown_unobserved` / `unknown_absent` | absence of evidence is coerced into a failure verdict |
| CREATE | equal spec, some uid | persisted | `unknown_incarnation` | a CREATE grant cannot carry an incarnation uid at issuance, so even same-uid reasoning is unavailable |
| Grant annotation present, same uid, equal spec | — | persisted | `state_consistent_grant_marked` | the strongest offline verdict — and a copied annotation from a different writer yields the identical verdict |

Three property tests pin the root cause rather than the symptom: the
production hash is identical across incarnation uid, across
`resourceVersion`, and with or without the grant annotation. Each of those
exclusions is correct for *authorization* (a server-assigned field must not
be able to force a false DENY) and each is exactly what *attribution* would
need.

**Result: H1 is refuted under this attack model.** No counterexample was
needed from a live cluster; the hash's own exclusion list is sufficient.
Naive hash-only correlation produces a false "persisted" on three paths and
cannot distinguish rejection from later overwrite on two more.

## What the result says about the architecture

1. **Equality is not attribution.** A read establishes what state exists,
   never which admitted request produced it. Any observation contract must
   permit `unknown` and must not contain a verdict that reads as a
   persistence attestation. The test asserts no verdict name matches
   `persist|applied|realized|verified|success`.
2. **Incarnation identity is necessary but not sufficient.** Binding
   `metadata.uid` separates "the admitted object is gone" from everything
   else; it does nothing for convergent writes on the same incarnation.
3. **The verifier is the wrong observer.** The one field that would bind a
   specific write to stored state — the `resourceVersion` the API server
   assigns *as a result of* that write — is produced after admission and
   returned in the write response to the **executor**, never to the
   admission webhook. The actor who can bind E1 to E2 is therefore the
   executor, not the verifier. This is a fourth role alongside
   approver / authorized actor / executor: an **observer** whose evidence
   is the executor's own response, which ChangeSafe does not currently
   receive and has no trust basis for. That is the problem existing
   abstractions cannot explain (filter D).
4. **Markers mark; they do not attribute.** The grant annotation and
   `managedFields` are client-writable. They raise confidence; they are not
   proof and must not be presented as such.

## Assumptions that need live verification

These are stated, not verified, and are the first things a kind run should
check before any contract is adopted:

- A validating admission webhook on CREATE sees `object.metadata.uid`
  already populated (the API server assigns it before validating
  admission). If true, the enforcer could record the CREATE incarnation
  uid at ALLOW time and lift the CREATE path from `unknown_incarnation`
  to incarnation-bound.
- ~~`resourceVersion` is contractually opaque: equality is meaningful,
  ordering is not.~~ Wrong; see the correction below.
- `managedFields` records the manager name a client chose; any principal
  with write access can present any manager name.

## Correction after review (2026-10-11)

PR #78's automated review found two errors in this note. Both are real,
checked against the Kubernetes API concepts documentation ("Resource
versions"). They are corrected here rather than rewritten above, and in
ledger row "M4-01/02 correction".

1. **The rejected-vs-overwritten fixture was impossible.** It gave the
   persisted-then-overwritten read the same `resourceVersion` (100) as the
   state before admission. A stored write advances the version, so that
   read cannot occur.
2. **Resource versions are not opaque for kube-apiserver.** Within one
   resource type they are ordered as increasing decimal integers, a
   conformance requirement from Kubernetes 1.35. Only versions from an
   aggregated API server that do not parse as decimals are equality-only.

What changes in the result:

- **A rejected write with nothing stored since is decidable.** If the
  enforcer records `oldObject.metadata.resourceVersion` and a later read
  of the same incarnation still shows it, nothing was stored since, so a
  state-changing admitted write was not. Equality alone decides this. The
  contract gains `no_write_since_admission`, and a read older than
  admission gains `unknown_stale_read`.
- **Once anything is stored after admission, the original conclusion
  stands.** "Persisted, then overwritten" and "rejected, then another
  writer changed and restored a field" can end on equal reads, because a
  version number is global per resource type. Ordering shows only that
  *something* was written, not whether it was the admitted write.
- **Second review round, same day.** Two ordering bugs in the corrected
  contract were found and fixed. First, a read older than the admission
  is now `unknown_stale_read` before any incarnation conclusion; a stale
  read from an earlier incarnation used to yield `not_this_incarnation`.
  Second, equal version strings decide "nothing stored since" even when
  they are opaque and cannot be ordered.
- **H1 is still refuted.** No case in the original table depended on
  version opacity except the one corrected above. The harness now models
  these histories with versions Kubernetes can produce, and compares them
  with the documented rule (`tests/integration/resource-version.ts`).

## What remains unsupported

- Nothing here attests E2 or E3. The experiment narrows what *could*
  attest E2 (the executor's write response) and shows what cannot (any
  state read alone).
- The contract is test-local by design. Promoting it to
  `@changesafe/core` requires the owner's decision and a live confirmation
  of the assumptions above.
- Rollout health, reconciliation, and E3 remain out of scope, as the M4
  decision already states.
- This is a negative result against a candidate design, not an
  adversarial finding against shipped behavior: ChangeSafe has never
  claimed E2, so no `CS-ADV` entry is opened.

## Next question

> **Can the executor's write response be bound to the grant it exercised,
> without ChangeSafe trusting the executor?**

The executor already holds the only E2 evidence (the post-write
`resourceVersion` and uid). The open design question is whether that
evidence can be made *checkable* by someone other than the executor — for
example by a later read that confirms the exact `resourceVersion` the
executor claims — and what an executor that lies gains and loses under
single-use grants. That question is counterexample-driven, like M2, and
should start with the minimal evidence shape the executor can produce today.
