---
name: changesafe-scenario
description: Author, review, or fix a ChangeSafe scenario in scenarios/. Use when adding a scenario, filling a failure-mode coverage gap, reviewing a contributed scenario, or when the scenario harness or gallery check fails.
---

# Authoring a ChangeSafe scenario

`docs/SCENARIO_AUTHORING.md` is the field reference — bundle shape, allowlisted
paths, common mistakes. Read it for *what goes in a file*. This is the loop for
*getting one right*, and the traps that are not obvious from the reference.

## The one rule

**Observe, then declare.** Write the incident and the proposal, run the gate,
read what the engine actually said, and only then write `expectations.json`
from what you saw.

Declaring first and hoping the engine agrees produces one of two outcomes: CI
fails, or — worse — you adjust the scenario until it matches a verdict you
guessed, and ship a scenario that documents a claim nobody checked.

Policy interactions are the reason this matters. They are not independent:

- A `PATCH_SCHEMA` BLOCK **cascades**. Policies that cannot apply the patch to
  a sandboxed copy (`MGMT_REACHABILITY`, `ROLLBACK_COMPLETE`) report BLOCK
  rather than staying silent, because a policy that cannot establish safety
  must not answer "fine". A scenario with an invalid operation will not have
  one BLOCK; it will have three.
- Every policy still runs after a BLOCK. There is no short-circuit.

## The loop

```bash
npm run build:cli    # the CLI is the fastest way to see a verdict

# 1. author scenarios/<id>/incident.json and replay-fixture.json

# 2. observe — this is the step people skip
node packages/cli/dist/changesafe.js gate --scenario scenarios/<id> --format json

# 3. write expectations.json from what step 2 printed

# 4. register in scenarios/index.ts — import trio + defineScenario entry.
#    A directory on disk that is not registered fails CI by design.

# 5. prove it
node packages/cli/dist/changesafe.js scenario check
npx vitest run tests/integration/scenario-contracts.test.ts

# 6. regenerate the gallery; CI fails if it drifts
node packages/cli/dist/changesafe.js scenario gallery --out docs/SCENARIOS.md
```

### Observing the simulation outcome

`gate` does not simulate. If the scenario is approvable you must also declare
`simulation.safetyPropertiesSatisfied`, and the only way to know it is to run
`runSimulation` — a throwaway test is the quickest path:

```ts
const sim = runSimulation(bundle, fixture.proposal);
// The result field is `safetyProperties` (an array of { satisfied, ... }).
// There is no top-level `safetyPropertiesSatisfied` on the result object —
// the harness derives it with `.every(p => p.satisfied)`.
```

## Choosing the corpus taxonomy

```json
"corpus": { "adversarial": true, "failureModes": ["prompt-injection"] }
```

`adversarial` means the proposal is built to get an unsafe change past a
reviewer. That includes honest-looking mistakes a prose review would approve —
not only deliberate attacks. `scenario-e-rollback-trap` is adversarial and
contains no attacker.

`failureModes` is a **closed enum** in `packages/core/src/expectations.ts`.
Adding a value is a deliberate change, not a convenience: an open field lets
the corpus drift into synonyms and stop being countable, which defeats the one
artifact meant to be a benchmark.

**Before authoring, check the coverage table in `docs/SCENARIOS.md`.** A
scenario exercising a mode with no coverage is worth far more than a second
example of one already covered. If every mode is covered, the valuable
contribution is a *new mode* plus the scenario that motivates it.

## Invariants the schema and harness enforce

These fail loudly, so know them before you fight them:

- **Risk and approvability are derived, not declared.** `riskLevel` must equal
  the deterministic derivation from your policy statuses, and `approvable` must
  equal "no BLOCK". The schema refuses a self-inconsistent file.
- **The release gate.** An adversarial scenario must be refused by the gate
  **or** flagged by simulation. One that is approvable *and* simulates cleanly
  describes a change that got through, and cannot be declared as an expected
  outcome at all.
- **Adversarial scenarios must name a failure mode.** Empty `failureModes` with
  `adversarial: true` is rejected.
- **Provenance honesty.** An authored fixture declares `model: null`; only a
  real capture may claim `captured`, and then it needs the model and timestamp.
- **Labels never leak the verdict.** Describe the incident; let the gate deliver
  the verdict. "the unsafe scenario" in a title is a review comment.

## Reviewing a contributed scenario

Same loop, in reverse. Do not read the expectations first — run step 2 against
their files, then compare what you saw to what they declared. A mismatch is the
finding; agreement means the contribution is self-proving.

Then check: does it cover a gap, or duplicate a covered mode? Is the taxonomy
honest (an injection scenario marked `adversarial: false` is rejected by the
schema, but a *mislabeled failure mode* is not)?

## If the harness fails

- `expectations declare scenario "x", expected "y"` — the id must match in all
  three files and in `index.ts`.
- Unregistered directory — step 4.
- `corpus: Invalid input: expected object` — an older scenario predating the
  taxonomy, or a scaffold from a stale CLI build. Rebuild the CLI.
- A red-team assertion failing — read `tests/integration/scenario-contracts.test.ts`
  before changing it. The invariant is "something catches every adversarial
  scenario", and it is deliberately broader than any provenance label.
