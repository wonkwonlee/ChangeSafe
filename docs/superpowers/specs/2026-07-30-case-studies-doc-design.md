# Portfolio Case Studies Document

**Date:** 2026-07-30

**Status:** Proposed for owner review

**Branch:** new branch off `main`, forked after PR #51's base

**Scope:** One new documentation file, `docs/CASE_STUDIES.md`. No code, policy,
or schema changes. No changes to the external `changesafe-portfolio` site
(out of reach from this repo).

## Decision

Add `docs/CASE_STUDIES.md`: a single narrative document aimed at a
recruiter/hiring-manager reader who has a few minutes and wants to judge
engineering ability quickly, not a contributor onboarding guide. It walks
through four scenarios already in the corpus, each following the same
shape: **situation → what the AI proposed → what the deterministic gate
did → the evidence**. Every claim links to the exact scenario directory and
`expectations.json` backing it — the document makes no assertion the repo
itself doesn't already prove in CI.

This is step one of a larger portfolio push (scenario corpus expansion,
now merged as PR #51 → this case-studies doc → workbench UI use-case
surfacing → a new domain), each sequenced and scoped separately.

## Why this document, and why these four scenarios

The existing `docs/SCENARIOS.md` is a generated, complete gallery of all 25
scenarios — accurate but flat, written for a contributor deciding whether a
new scenario duplicates an existing one. It is not written to be read start
to finish by someone deciding whether to take a meeting. `docs/CASE_STUDIES.md`
is a curated, hand-written *subset*, chosen for narrative range rather than
completeness:

1. **`scenario-a-failover`** (network, LOW, approvable) — the safe path.
   A well-evidenced, minimal, fully-verified change clears every policy.
   Establishes that the gate is not a rubber stamp that blocks everything —
   it has to let good changes through, or the "human decides" claim is
   hollow.
2. **`scenario-b-route-leak`** (network, CRITICAL, adversarial) — the
   flagship. Incident data carries an injected instruction; the proposal
   obeys it; the gate blocks anyway because `PROTECTED_RESOURCE` and
   `MGMT_REACHABILITY` are computed from device state, not read from the
   model's reasoning. This is the strongest single proof point in the repo
   and the one the README already leads with.
3. **`scenario-p-injected-pr-context`** (terraform, CRITICAL, adversarial)
   — the same injection story, but in the AI-coding-agent-opens-a-PR world
   rather than the network-ops world, proving the trust model is a general
   principle and not a network-specific trick. (Added in the immediately
   preceding scenario-corpus-expansion work, PR #51.)
4. **`scenario-g-silent-regression`** (network, LOW, approvable, flagged by
   simulation) — the subtle one. Every deterministic policy passes; the
   sandbox then shows a declared safety property breaks anyway. This is the
   case that proves "the gate passed it" and "it's a good idea" are
   deliberately different claims — the load-bearing nuance behind "a human
   decides."

Four is enough range (safe / blocked-by-injection x2 domains / gate-vs-judgment)
without diluting into a second `SCENARIOS.md`. A recruiter reading top to
bottom gets the whole trust-model argument in four short beats.

## Structure

```text
docs/CASE_STUDIES.md
  # intro: one paragraph, the trust model one-liner, a pointer to
    docs/SCENARIOS.md for the full corpus and to the README's quickstart
    for running it yourself
  ## Case 1: <headline claim, one line>
    situation (1-2 sentences, grounded in the scenario's incident.json)
    what the AI proposed (1-2 sentences)
    what the gate did (the actual PASS/WARN/BLOCK findings, by name)
    evidence (relative link to the scenario directory + expectations.json)
  ## Case 2 .. 4: same shape
  ## Try it yourself (short: npm run dev, which workbench route, which
    scenario id to pick in the picker)
```

Each case study section is short — 150-250 words — matching the "a few
minutes" reading budget. No screenshots in this pass (the workbench UI
screenshots already exist in `docs/screenshots/` from the vNext refresh;
reusing 1-2 of them is a nice-to-have the writing pass can decide on, not a
requirement).

## Content rules (binding, mirrors `docs/SCENARIO_AUTHORING.md`'s own honesty
requirements)

- Every finding cited (PASS/WARN/BLOCK, policy id) must match the real
  scenario's `expectations.json` exactly — copy-paste from the file, don't
  paraphrase from memory.
- No invented outcomes, no rounding a WARN up to a BLOCK for narrative
  punch.
- State plainly that data is synthetic/fictional where the case study
  describes incident specifics (matching every existing scenario's own
  framing).
- Do not claim capabilities the repo doesn't have (no execution, no model
  autonomy over approval — restate the core invariant if useful, don't
  contradict it).

## Out of scope

- The external `changesafe-portfolio` site — not reachable from this repo,
  not touched by this work.
- Workbench UI changes to surface these case studies inside the app — a
  separate, later sub-project.
- Screenshots/diagrams beyond optionally reusing existing ones.
- Any change to `docs/SCENARIOS.md`, scenario data, or scenario registration.

## Testing

None required (pure prose, no code path). The one factual check: after
writing, re-read each cited scenario's `expectations.json` and confirm
every policy status named in the document matches byte-for-byte.
