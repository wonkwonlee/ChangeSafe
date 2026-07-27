# Contributing to ChangeSafe

Thanks for considering a contribution. ChangeSafe is a deterministic
airlock for AI-proposed infrastructure changes — the project's value comes
from the guarantees it keeps, so the bar for changes that touch safety
behavior is deliberately high, while **scenario contributions are the
easiest and most valuable way in**.

Read `docs/OSS_ROADMAP.md` for where the project is going, and `CLAUDE.md`
for the invariants every change must respect.

The engine lives in workspace packages: `@changesafe/core` is the
domain-agnostic gate (see `packages/core/README.md`),
`@changesafe/domain-network` teaches it about networks through the
`DomainAdapter` contract, and `changesafe` (see `packages/cli/README.md`) is
the CLI. The Next.js console at the repository root is a consumer, not the
product.

Fastest loop while working on scenarios or policies:

```bash
npm run build:cli
node packages/cli/dist/changesafe.js scenario check
```

## Setup

```bash
node --version   # >= 22 (see .nvmrc)
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

If something else already uses port 3000, run the app and the suite on
another port: `PORT=3100 npm run dev` / `PORT=3100 npm run test:e2e`.
If the dev server was running while you edited `next.config.ts`, restart it
— Turbopack does not pick up config changes and will serve a stale bundle.

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

A scenario lives in `scenarios/<scenario-id>/` and contains three files:

- `incident.json` — the untrusted input (alerts, operator notes, topology,
  declarative state, safety properties).
- `replay-fixture.json` — one proposed change with honest provenance.
- `expectations.json` — what the gate must do with it, verified in CI.

**Read [docs/SCENARIO_AUTHORING.md](docs/SCENARIO_AUTHORING.md)** for the
field-by-field guide, the reachability rules that decide whether your
management paths behave, and a table of which verdicts are already covered
versus which gaps are worth filling.

Checklist before opening the PR:

- [ ] All data fictional; documentation IP ranges only.
- [ ] Every `evidenceId` cited by the proposal exists in the bundle.
- [ ] Operation paths target real devices/resources in the bundle state.
- [ ] Provenance labeled honestly (authored fixtures set `model: null`).
- [ ] Registered in `scenarios/index.ts` with an incident-styled label that
      describes the situation, never the verdict.
- [ ] `npm test` passes — the harness verifies your `expectations.json`
      against the real engine.
- [ ] The PR says what the scenario teaches that existing ones do not.

## Pull requests

- Keep PRs focused; a scenario, a policy fix, and a refactor are three PRs.
- Run the full local gate before pushing.
- Describe the safety reasoning for anything touching `packages/core/src/`
  or a domain package's policies and patch engine — say what invariant the
  change preserves and which test proves it.
- Policy behavior changes must bump `CORE_POLICY_VERSION`
  (`packages/core/src/version.ts`) or the domain's `policyVersion`, and
  update the affected receipt tests.
- Commit messages: imperative subject, body explaining why.

## Releases (maintainers)

The GitHub Action is consumed by tag, so a fix that is merged but untagged
has not shipped to anyone using it.

- **Immutable tag per release**: `v0.1.1`, never moved once pushed. This is
  what release notes and documentation pin.
- **Moving major tag**: `v0` is repointed at the newest `v0.x` so consumers
  who prefer automatic patches get them. It is the only tag that ever moves.
- Release notes live in `docs/RELEASE_NOTES_<version>.md` and say plainly
  what a user must *do*, not only what changed — a fix inside a workflow
  people were told to copy does not reach them by bumping a pin.
- A release does not modify `verification/`. Published snapshots are
  evidence about the version that produced them; rebuilding one to make it
  agree with newer code would destroy the only thing it proves.

```bash
git tag -a v0.1.1 -m "ChangeSafe v0.1.1" && git push origin v0.1.1
git tag -f v0 v0.1.1 && git push -f origin v0   # the one tag that moves
```

## Reporting problems

- Security issues: follow `SECURITY.md` (private reporting), not a public
  issue.
- Bugs and scenario ideas: use the issue templates. For a suspected gate
  bug, include the input, the proposal, the findings you got, and the
  findings you expected.
