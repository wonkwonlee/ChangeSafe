# ChangeSafe — Development Strategy

Status: active
Adopted: 2026-08-08
Supersedes: the sequencing in `docs/OSS_ROADMAP.md` (phase gates there remain
valid as technical detail; milestone ordering is governed by this document)

---

## What this project is

ChangeSafe is a **flagship personal systems project** — a long-running
laboratory for one question, not a startup and not a portfolio piece that gets
finished and forgotten.

It is deliberately *not* being optimized for customers, revenue, stars, or
adoption counts. It is being optimized for technical depth, architectural
coherence, honest claims, and conceptual progression over years.

If external pull appears on its own, whether to commercialize becomes a real
question again. Until then it isn't one.

### The central question

> **How should an autonomous system be authorized to change consequential
> systems?**

Every milestone attacks this question in a harder environment. Technologies
(Kubernetes, MCP, TLA+, eBPF) are instruments for answering it, never
destinations.

---

## Operating principles

1. **Central question first.** Work is justified by the question it answers,
   not by the technology it introduces.
2. **Technology is never a milestone.** No issue is titled "Add X." Issues are
   titled with questions.
3. **Every experiment ships.** The project may never be finished; every
   experiment must be. Each milestone has an explicit definition of done and a
   date.
4. **External critique is part of engineering.** Outside review exists to
   generate hypotheses the author would not have originated — it is blind-spot
   discovery, not marketing.
5. **Attack every claim.** Every milestone carries an adversarial release gate.
   There is no separate "testing phase."
6. **Record failures publicly.** `docs/ADVERSARIAL_FINDINGS.md` and
   `docs/LESSONS_LEARNED.md`. Absence of a finding is itself a result and gets
   recorded as such.
7. **Do not optimize for stars or customers.** Do actively seek independent
   reproduction and informed criticism.
8. **The next question comes from the previous result.** No six-month feature
   roadmap is fixed in advance.

Two further principles belong in `docs/ARCHITECTURE.md` alongside the existing
trust-boundary rules, because they constrain the architecture rather than the
process:

> **7. Authorization is not execution.** A decision or authorization
> establishes bounded permission; it does not attest that an action occurred.
>
> **8. Execution is not verified effect.** Observing or authorizing a requested
> operation does not prove the intended system state was realized.

---

## The decision filter

Before any significant piece of work, answer four questions. **At least three
must be Yes.** Otherwise it goes to backlog or is dropped.

| # | Question |
|---|---|
| A | Does this probe the central thesis more deeply? |
| B | Do I learn a genuinely new systems concept by doing it? |
| C | Does it produce an engineering story I can discuss in depth for 15+ minutes? |
| D | Does it surface a new engineering problem that existing ChangeSafe abstractions cannot explain? |

Filter D is the one that distinguishes progression from accumulation. Work that
passes A–C but fails D is usually polish; work that passes D is usually where
the project actually grows.

### Known anti-patterns

- **Technology collection.** A list of impressive technologies attached to one
  project is not depth. It reads as depth and is not.
- **Permanent unfinishedness.** "Living project" must not become "nothing ever
  ships." The milestone boundary is the forcing function.
- **Breadth as escape.** Adding a fourth domain is easier than going one level
  deeper into an existing one, and worth much less.
- **Building before exposure.** Extended construction without any external eyes
  reliably produces solutions to problems only the author has.

### Explicit backlog freeze

Not in scope, not scheduled, no issues opened: eBPF, chaos engineering,
distributed ledger, WASM policy sandbox, Rego integration, OpenTelemetry,
reproducible builds, SLSA levels, new infrastructure domains, JWT/Macaroons/
SPIFFE/OAuth token exchange/Zanzibar-style authorization.

Any of these may return later — but only when a milestone result creates the
need, never because the technology is interesting.

---

## Claim discipline

ChangeSafe's credibility rests on claiming only what it can prove. That
discipline applies to the roadmap, not just the README.

### Effect vocabulary

| Stage | Meaning |
|---|---|
| **E0** | Authorized proposal — what ChangeSafe approved |
| **E1** | Admitted request — the object observed at the final validation boundary, after mutations and defaulting |
| **E2** | Persisted state — what the API server actually stored |
| **E3** | Realized effect — the actual system state after controllers reconcile |

ChangeSafe can currently reason about E0 and, from M2 onward, bind E0 to E1.
It cannot attest E2 or E3. `ALLOW` at an admission boundary is not a
persistence attestation: a later admission stage or the API server itself may
still reject the request.

The E1 → E2 → E3 gap is a documented open research question, not a scope item.

### Authority vocabulary

Three roles that are currently collapsed and must be separated at M2:

| Role | Question |
|---|---|
| **Approver** | Who decided this change was acceptable? |
| **Authorized actor** | Who may exercise that decision? |
| **Executor** | Who actually sent the request to the control plane? |

And two objects that must not be conflated:

- **`ChangeReceipt`** — durable evidence of *what was decided*. Already exists.
  Its `decision` field includes `gate_only`, which is explicitly not an
  approval; overloading this type with authority semantics would corrupt that
  invariant.
- **`AuthorizationGrant`** — a statement of *what may now be exercised, by whom,
  under what bounds*. Does not exist yet. Introduced at M2, not before.

---

## Milestones

### M0 — Expose assumptions · target 2026-08-15

Purpose: find out what we are not seeing.

- Pin a baseline commit SHA before sending anything; the baseline does not
  change during the review round.
- **Track A — perception review**, 4–5 reviewers, README and live demo only.
  Q1: what do you understand this system to guarantee? Q2: most convincing part
  and most toy-like part?
- **Track B — adversarial review**, at least one reviewer, ideally two, at least
  one an actual Terraform/Kubernetes practitioner. Q3: what feels
  insufficiently justified relative to the claims? Q4: top three reasons you
  would not put this in a production control path? Q5: where would you attack
  first?
- **Collect all feedback before fixing anything.** Two reviewers independently
  finding the same problem is the strongest available signal, and fixing after
  the first response destroys it. Exception: a publicly exploitable security
  issue.
- Add npm publish provenance (`--provenance`) — the project argues that
  AI-generated changes must be verified, so shipping its own packages without
  provenance is a live contradiction.
- Output: an internal intake table (ID, reviewer type, finding, frequency,
  severity, resulting M1 attack hypothesis). **Review feedback is not an
  adversarial finding.** Only reproduced or technically verified issues get
  promoted to `ADVERSARIAL_FINDINGS.md`.

Done when: ≥3 independent reviews received, including ≥1 from someone who
operates infrastructure, and the M1 attack backlog is written.

### M1 — Make it real · target 2026-08-31

Purpose: prove the claimed story holds in a real control flow.

Two paths, both exercised:

- **PR A (benign)** — AI proposes a small change; ChangeSafe PASSes; Terraform
  applies.
- **PR B (hostile)** — AI proposes a destructive change to a protected
  stateful resource, with PR-body text instructing the tooling to approve
  anyway; ChangeSafe BLOCKs; apply never occurs; a signed receipt is produced.

Reproduction is tiered:

- **Tier 1 — independent reproducibility (required).** A reviewer with no cloud
  credentials reproduces the full flow from a captured `terraform show -json`
  fixture. `npx changesafe` plus a template repo for the PR + Action path. The
  external-reproduction condition applies **only** to Tier 1.
- **Tier 2 — real-world demonstration (required of me, not of reviewers).**
  Actual AWS sandbox: real plan, real apply on the benign path, apply never
  reached on the hostile path. Evidence captured.

Adversarial release gate — all must be exercised before done: happy path,
malicious path, malformed input, receipt tampering, missing artifact, Action
failure, unexpected Terraform output, and a pass over the M0 hypotheses.

Also due: first `ADVERSARIAL_FINDINGS.md` entries, a `LESSONS_LEARNED.md`
entry, and one short public engineering note — what was claimed, what external
review surfaced, what broke on the real path, which invariants changed, what is
still not guaranteed. A technical note, not a content-marketing project;
it must not extend the milestone.

**Do not implement `AuthorizationGrant` here.** If the need becomes visible
during M1, write a design memo and wait. The milestone boundary is the scope
control mechanism.

### M2 — Bind authorization to enforcement · target September 2026

> **Can a ChangeSafe authorization be exercised only by the authorized actor,
> for the exact operation, resource, and canonical object it was issued for?**

This is where the first genuinely new core abstraction appears:

```
Proposal → Gate → Decision → ChangeReceipt
                                   │
                                   ▼
                          AuthorizationGrant
                                   │
                                   ▼
                          Authorized Actor
                                   │
                                   ▼
                             Enforcement
```

Start with the smallest representation that could work — grant id, source
receipt id, authorized actor, operation, resource, object hash, policy version,
issued-at, expires-at, signature. Add nonce/use-state/anything else **only when
an experiment produces a counterexample that demands it.** M2 is
counterexample-driven design; jumping straight to an existing token ecosystem
would be technology collection wearing a different hat.

Attack cases: object substitution, resource substitution, operation
substitution, identity substitution, replay, stale/expired grant, policy
version drift, request mutated after authorization.

Also in scope: risk-sensitive failure semantics. `failurePolicy: Ignore` on an
authorization verifier means roughly "if the lock breaks, unlock the door" —
but making every namespace fail-closed turns ChangeSafe into a cluster
availability dependency. Protected scopes and low-risk scopes may deserve
different answers, and the experiment is to find out.

Kubernetes is the test environment, not the subject.

Explicit non-claims, stated in the deliverable: `ALLOW` ≠ persisted ≠
reconciled ≠ realized effect.

Output: kind/local cluster reproduction, failure-mode document, the E1/E2/E3
gap written up as an open question, adversarial release gate, and a 90-second
demo — authorize, exercise correctly (ALLOW), reuse the same authorization with
a modified object (DENY), and show fail-closed behavior when the verifier is
unavailable.

### M3 — State the guarantees · 1 week, hard cap

A small TLA+ model of the authorization protocol invariants that **actually
mattered in M2** — not a textbook transcription of the existing state machine.
Deliberately introduce a broken transition and let the model checker produce
the counterexample.

The goal is not "I have used formal methods." It is: *can I state precisely
what ChangeSafe guarantees?*

### M4 — undefined

Deliberately not scheduled. Candidates include effect verification,
generalization to arbitrary agent actions, and deeper Kubernetes authorization
semantics. M2 and M3 results decide which — that is the point.

---

## Version narrative

Versions record engineering questions, not feature releases:

| | Question |
|---|---|
| v0.x | Can deterministic policies gate AI-generated infrastructure changes? |
| next | Where do the stated guarantees stop being true? |
| next | Can an authorization be bound to the exact request at a real enforcement boundary? |
| next | Can the authority model be formally specified? |
| later | Does the same primitive govern actions outside infrastructure? |

## On Physical OS

Not a roadmap item. A **hypothesis**: that `proposal → authorization →
capability → effect → observation → verification` recurs across environments
and eventually names a larger runtime abstraction.

It earns the right to exist as code only if those abstractions keep reappearing
on their own. Notably, `Approver ≠ Authorized actor ≠ Executor` arrived at M2
by digging into ChangeSafe itself — not by importing the vision. That is the
only legitimate way for it to arrive.
