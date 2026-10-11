# Research loop ledger

Append-only. One row per iteration of the
[research loop](STRATEGY.md#the-research-loop-method). Rows are never
edited after the iteration's branch is offered for merge. A correction is
a new row that names the row it corrects.

Column meanings:

- **Result** is one of *refuted*, *not refuted under* &lt;attack model&gt;,
  or *unknown*.
- **Counterexamples** counts distinct cases where the hypothesis gave a
  wrong or falsely certain answer.
- **Overclaims caught** counts claims the agent drafted, caught, and
  removed or corrected before the work was offered. These include claims
  made to the owner in conversation, not just in files.
- **Human decisions** lists what the iteration cannot settle by itself.
- **Adopted** is what the owner later took into the codebase. It is filled
  by a later row, never by the iteration itself.

| # | Date | Question | Hypothesis | Result | Counterexamples | Overclaims caught | Human decisions | Adopted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [M4-01](M4_EXPERIMENT_01.md) | 2026-10-11 | Can a read of stored state be attributed to the request that was admitted? | H1: hash equality after ALLOW means the admitted write persisted | refuted (offline) | 5: recreated incarnation, convergent re-apply, CREATE without incarnation, copied annotation, rejected-vs-overwritten indistinguishable | 0 | adopt the observation contract into core? | — |
| [M4-02](M4_EXPERIMENT_02.md) | 2026-10-11 | Can the executor's write response be bound to the grant it exercised, without trusting the executor? | H2: a read at the executor-claimed uid and resourceVersion confirms persistence | refuted (offline); server-record shape proposed, unverified | 2: claim unfalsifiable after any later write; liar claims another writer's version | 1: the agent told the owner the 01 contract "initially had a `persisted` verdict" that was removed; it never did, and this was retracted before the ledger was written | P1 audit annotations, P2 admission uid in use-state, whether to run the live kind audit check | — |
| [M4-03](M4_EXPERIMENT_03.md) | 2026-10-11 | Does the Kubernetes audit record carry an admission webhook's annotation through to the response outcome for both persisted and rejected writes? | H3a–H3e, pre-registered before the live run; H3b (annotation survives a later rejection) the least certain | not refuted under one live kind run (H3a–H3e as predicted); refutes M4-02's first-event audit rule | 1: the first audit event for a grant is a dry-run whose 200 response shows a state never stored, so M4-02's rule reports a false contradiction against an honest executor | 0 | next question (audit-pipeline adversary); whether an observation contract is proposed for core | from M4-02: P1, P2 (owner, 2026-10-11, PR #79) |
| [M4-01/02 correction](M4_EXPERIMENT_01.md#correction-after-review-2026-10-11) | 2026-10-11 | Are resource versions opaque, as rows M4-01 and M4-02 assumed? | correction of M4-01 and M4-02, not a new hypothesis | assumption refuted (Kubernetes docs: ordered within a resource type, conformance-required from 1.35); M4-01 and M4-02 hypotheses still refuted | 0 new. Narrows M4-01 (rejected with nothing stored since is decidable by version equality) and M4-02 (only past-version claims are unfalsifiable) | 0 by the agent. 2 found by PR #78's automated review after the work was offered: "contractually opaque", and a fixture with a version no stored write can leave | — | — |
| [M4-01/02 correction, round 2](M4_EXPERIMENT_01.md#correction-after-review-2026-10-11) | 2026-10-11 | Did the round-1 correction get the version logic right? | correction of the round-1 correction | partly: two ordering bugs fixed (stale read checked before incarnation; equal opaque versions decide "nothing stored since") | 1: a pre-consumption DENY carrying the grant id makes M4-02's first-match audit rule wrong (fixed by M4-03's admission-uid join) | 0 by the agent. 3 found by PR #78's second automated review round | — | — |
| [M4-04](M4_EXPERIMENT_04.md) | 2026-10-11 | What can a party who controls the audit pipeline make an E2 observation say? | H4a–H4e, pre-registered before the harness: drops and injections degrade to unknown; flips and fabrications fool audit evidence; a read catches them only when nothing was stored since | not refuted (offline, on 03's real evidence; three truths modeled) | 4 wrong verdicts the attack model produces: a flipped code, a fabricated grant-consistent 200, a forged version between admission and now, and a stored write hidden behind a 500 (not predicted, never caught) | 0 | P3 (record the prior resourceVersion), P4 (verdicts name their evidence source); next question (watch observer in the protected tier) | — |
| [M4-04 correction](M4_EXPERIMENT_04.md#correction-after-review-2026-10-11) | 2026-10-11 | Did M4-04 overgeneralize "never caught"? | correction of M4-04, not a new hypothesis | partly: the reverse attack is not caught by a version-based read, but a carrier-aware read catches it where the tier makes the carrier unforgeable, and is wrong where it is writable | 1: a carrier-aware rule falsely contradicts a true rejection when another writer can copy the carrier (found by the corrected harness) | 0 by the agent. 10 found by the first internal code review of PR #80, among them an overgeneralized claim and an unverified prior-version provenance | whether the protected tier makes the carrier unforgeable (tested live in M4-05) | — |
| [M4-04 correction, round 2](M4_EXPERIMENT_04.md#correction-after-review-2026-10-11) | 2026-10-11 | Did the first M4-04 correction overstate what the harness found? | correction of the M4-04 correction | partly: one of the correction's own claims is withdrawn | -1: the "carrier writable" case counted as a counterexample is a precondition made explicit, not a flaw found; the correction row above overcounted it | 0 by the agent. 9 more found by the second internal code review, among them a dead link to an unrecorded measurement, a dry-run check that gave no defense, and an order-dependent vocabulary test | — | — |
| [M4-05](M4_EXPERIMENT_05.md) | 2026-10-11 | Does a watch from an independent observer settle stored versus rejected for the consuming admission? | H5a–H5e, pre-registered before the harness; H5a (the write is one distinct event) the least certain | not refuted under one live kind run (protected tier); closes M4-04's hidden-write gap on the recorded evidence | 2 beyond the hypotheses: the read taken before the write is not the admission's prior version (three status-only events intervened), and five events name grant 1 while one is the write | 0 | P3 now matters for coverage; whether to adopt P3, P4; M4-06 registered | — |
| [M4-05 correction](M4_EXPERIMENT_05.md#findings-the-predictions-did-not-cover) | 2026-10-11 | Did M4-05's contract treat absence of a watch event as evidence without an upper bound? | correction of M4-05, not a new hypothesis | partly: absence needs the stream to reach the object's version at close; the "three status-only events" count was an overclaim (two provably, one unclassifiable) | 1: a stream cut before the write reads a true "stored" claim as contradicted | 0 by the agent. 7 found by the first internal code review of PR #81 | — | — |

## Loop observations

Kept to what the rows show. These are not claims about the method.

- Two iterations, both offline, both refuted the hypothesis under test. Both
  hypotheses were chosen *expecting* refutation. The loop has not yet tested
  a hypothesis it expected to survive, so it has not yet shown it can
  produce a surprising positive result.
- Iteration 02's server-record cases test a model of Kubernetes. Their
  passing is close to true by construction. The next iteration is the first
  that needs a live environment, which makes it the first real test of the
  02 proposal.
- The first overclaim the loop caught was in the agent's conversation with
  the owner, not in a file. Overclaims in conversation are counted here for
  that reason.
- After 03 (supersedes the first bullet above): the loop has now tested
  hypotheses it expected to survive, on a live API server, and they did.
  The finding it did not predict came from the evidence, not from the
  hypotheses: a counterexample to the loop's own earlier proposal (M4-02's
  audit rule). Predictions were committed before the run, so the result
  could not reshape them.
