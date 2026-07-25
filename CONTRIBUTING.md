# Contributing to ChangeSafe

Thanks for considering a contribution. ChangeSafe is a deterministic
airlock for AI-proposed infrastructure changes — the project's value comes
from the guarantees it keeps, so the bar for changes that touch safety
behavior is deliberately high, while **scenario contributions are the
easiest and most valuable way in**.

Read `docs/OSS_ROADMAP.md` for where the project is going, and `CLAUDE.md`
for the invariants every change must respect.

## Setup

```bash
node --version   # >= 20.9 (see .nvmrc)
npm install
npm run dev      # http://localhost:3000, works with no API key
```

Full local gate (what CI runs):

```bash
npm run lint
npm run typecheck
npm test          # no network, no API credit
npm run build
npx playwright install chromium   # once
npm run test:e2e
```

## Ground rules

1. **Never add an execution path.** No SSH/NETCONF/RESTCONF/SNMP/gNMI-SET,
   no vendor SDKs, no shell execution, no `terraform apply`, no outbound
   requests driven by input data. Ingestion is read-only artifacts.
2. **The gate stays deterministic.** Policies are pure functions of
   (input, proposal). They may not import AI modules, read the clock, use
   randomness, or receive model confidence.
3. **A `BLOCK` finding is final.** No code path — UI, API, or CLI — may
   approve or simulate a blocked proposal. There is no auto-approval
   feature and there never will be.
4. **All bundled data is fictional and publishable.** Use documentation IP
   ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24). No real
   organizations, customer data, third-party branding, or PII.
5. **Provenance is honest.** Authored fixtures are labeled authored and are
   never attributed to a model; captured fixtures carry capture metadata.
6. **Tests are part of the change.** Every behavioral change includes or
   updates the smallest relevant test. Never weaken a test to make an
   implementation pass — fix the implementation, or document the
   specification conflict in the PR.

If a change you want conflicts with one of these, open an issue first and
describe the goal; there is usually a design that fits.

## Contributing a scenario

Scenarios are synthetic incidents plus a proposal fixture that demonstrate
how the gate behaves — including adversarial ("red-team") ones where the
proposal is intentionally unsafe. Good scenarios teach something specific:
a policy nobody has exercised yet, a verdict level the demo lacks, or a new
way a plausible AI proposal can be wrong.

A scenario lives in `scenarios/<scenario-id>/` and contains:

- `incident.json` — an `IncidentBundle`: alerts and operator notes with
  stable `ev-*` evidence ids, a topology, the declarative current state,
  and the safety properties the change must preserve.
- `replay-fixture.json` — a `ReplayFixture` wrapping one `ChangeProposal`,
  with `provenance` set to `authored_synthetic`, `authored_red_team`, or
  `captured_gpt_5_6` (captured requires `model` and `capturedAtUtc`;
  authored requires `model: null`).

Both files are validated against the production Zod schemas when
`scenarios/index.ts` loads, so a malformed scenario fails fast. Register
the scenario in `scenarios/index.ts` with an incident-styled label that
describes the situation — never the expected verdict.

Checklist before opening the PR:

- [ ] All data fictional; documentation IP ranges only.
- [ ] Every `evidenceId` cited by the proposal exists in the bundle.
- [ ] Operation paths target real devices/resources in the bundle state.
- [ ] Provenance labeled honestly (authored fixtures claim no model).
- [ ] `npm test` passes, including the scenario contract tests.
- [ ] The PR states what the scenario is *supposed* to demonstrate
      (expected findings, risk level, whether it should be approvable).

The scenario expectations harness described in `docs/OSS_ROADMAP.md` (P1)
will turn that last point into a machine-checked `expectations.json`; until
it lands, state expectations in the PR description.

## Pull requests

- Keep PRs focused; a scenario, a policy fix, and a refactor are three PRs.
- Run the full local gate before pushing.
- Describe the safety reasoning for anything touching `lib/policies/`,
  `lib/patch/`, `lib/domain/state-machine.ts`, or `lib/receipt/` — say what
  invariant the change preserves and which test proves it.
- Policy behavior changes must bump `POLICY_VERSION` in
  `lib/domain/version.ts` and update the affected receipt tests.
- Commit messages: imperative subject, body explaining why.

## Reporting problems

- Security issues: follow `SECURITY.md` (private reporting), not a public
  issue.
- Bugs and scenario ideas: use the issue templates. For a suspected gate
  bug, include the input, the proposal, the findings you got, and the
  findings you expected.
