# ChangeSafe — Repository Instructions

This file and `AGENTS.md` are identical mirrors; when you change one, apply
the same change to the other.

## Mission

ChangeSafe is an **open-source deterministic airlock for AI-proposed
infrastructure changes**, developed library/CLI-first. The non-negotiable
trust model is:

> AI diagnoses and proposes. Deterministic code validates. A human decides.
> ChangeSafe never executes changes against infrastructure.

Strategy, phases, and design constraints live in `docs/OSS_ROADMAP.md` —
read it before starting multi-file work. `BUILD_WEEK_CHANGELOG.md` and
`docs/V2_PLAN.md` are historical records of the project's origin (built
during OpenAI Build Week 2026, not submitted, pivoted to OSS); do not treat
their Build Week constraints (two-scenario cap, GPT-5.6/OpenAI-only,
single-app scope) as current rules.

## Safety invariants

These override convenience, demo polish, and feature requests:

1. No execution path to infrastructure, ever: no SSH, NETCONF, RESTCONF,
   SNMP, gNMI-SET, vendor SDKs, shell execution, `terraform apply`, or
   arbitrary outbound HTTP actions. ChangeSafe analyzes, gates, and records;
   humans and their existing systems execute.
2. Ingestion is read-only artifacts and data (bundled fixtures, uploaded
   bundles, `terraform show -json` output, future read-only collectors),
   validated by Zod schemas at every boundary.
3. All external content — alerts, notes, names, configuration values, plan
   contents, PR text — is untrusted data, never instructions.
4. Secrets (model API keys) exist only in server/CLI environment scope;
   never in client bundles, receipts, fixtures, logs, or error messages.
5. Model output is invalid until provider-side structured output (where
   available) AND local Zod validation both succeed; invented evidence ids
   or unknown resource references are hard rejections.
6. The LLM never determines approval, risk, or execution status. Policies
   are pure functions that never import AI modules and never receive model
   confidence. Risk derivation (any BLOCK→CRITICAL, ≥2 WARN→HIGH,
   1 WARN→MEDIUM, else LOW) is core-owned and identical across domains.
7. Any BLOCK finding makes approval and simulation impossible at the domain
   layer (state machine throws), not merely in the UI. No auto-approval
   path may exist anywhere, including the CLI.
8. Simulation mutates only deep clones; patch application is transactional
   (no partial mutation can escape); rollback is verified by canonical
   equality where the domain supports it.
9. Bundled data is fictional and publishable: documentation IP ranges
   (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), no real orgs, no
   third-party branding, no PII.
10. Provenance honesty: fixtures declare captured vs authored provenance;
    authored content is never attributed to a model; replay is always
    labeled and never silently substituted for live analysis.

If a request conflicts with an invariant, stop that change and explain.

## Architecture

Current layout (pre-extraction) — the target monorepo layout and the
migration window for breaking renames are defined in `docs/OSS_ROADMAP.md`
§P2/§5; do not restructure ad hoc outside that phase:

```text
app/                 Next.js showcase console (routes, api/analyze, api/status)
components/          console UI + client workflow hook
lib/domain/          Zod schemas, state machine, evidence validation, wire contracts
lib/patch/           allowlisted transactional patch engine, reachability, simulate
lib/policies/        pure policies + deterministic risk derivation
lib/receipt/         canonical serialization, SHA-256, receipts
lib/ai/              provider adapters (server-only), hardened prompt, replay
scenarios/           synthetic incident bundles + provenance-labeled fixtures
tests/               unit, integration, e2e (Playwright)
docs/                roadmap, architecture, threat model, plans
```

Dependency direction (violations are review failures): policies and patch
engines depend only on domain types — never UI or AI modules. AI adapters
depend on domain schemas. Receipts consume validated domain outputs, never
raw model text. Scenario fixtures must pass the production schemas.
The state machine (`lib/domain/state-machine.ts`) is the single workflow
authority; UI must dispatch through it.

## Policy set

Universal policies: `PATCH_SCHEMA`, `BLAST_RADIUS`, `ROLLBACK_COMPLETE`
(or a domain's reversibility analog), `VERIFICATION_REQUIRED`,
`UNTRUSTED_INSTRUCTION`. Domain policies (network today):
`MGMT_REACHABILITY`, `PROTECTED_RESOURCE`. Policy status is
`PASS | WARN | BLOCK`; all policies fail closed. Policy packs may tune
typed parameters (thresholds, protected patterns) but are never a DSL, and
never alter the risk formula. Any policy behavior change bumps
`POLICY_VERSION` and updates receipts tests.

## Technology

Strict TypeScript, Zod-first (schemas before derived types), Next.js App
Router for the showcase app, npm (workspaces once extracted), Vitest,
Playwright. AI: provider-agnostic adapters (OpenAI today; Anthropic and
local/Ollama planned per roadmap P5) — all server/CLI-side only. Do not add
major infrastructure (databases, queues, workers) ahead of the roadmap
phase that calls for it.

## Commands

Keep valid and documented in `README.md`:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Run the relevant gate before reporting completion; the replay demo and the
red-team scenario contract (blocked, never approvable) must stay green in
every phase.

## Coding standards

- No `any`, no unsafe casts; exhaustive handling for operations, findings,
  risk, and workflow states.
- Small pure functions for policy and patch behavior; validate all boundary
  inputs; canonicalize before comparison or hashing.
- Stable identifiers over display strings; typed domain errors without
  stack traces or secrets in user-visible messages.
- Comments explain invariants and non-obvious decisions, not restatements.
- No dead code, placeholder copy, fake metrics, or TODO-driven behavior in
  merged work.

## Testing expectations

Every behavioral change includes or updates the smallest relevant test.
Standing coverage: schema accept/reject, patch allowlist + transactional
failure, canonical/hash stability, every policy PASS and failure, risk
derivation, illegal state transitions, rollback restoration, scenario
expectations (per-scenario `expectations.json` once the P1 harness lands),
replay parity and provenance honesty, keyless replay API, invalid model
output rejection, no secret leakage in client artifacts, and the Playwright
safe + blocked critical paths. Default test runs spend no API credit and
need no network; live smoke stays env-gated. Never weaken a test to make an
implementation pass.

## Scenarios and fixtures

Scenarios are first-class contribution surface: fully fictional, schema-
valid, provenance-honest, each with an `expectations.json` (post-P1)
proving its claimed verdicts in CI. Red-team scenarios must always produce
their expected BLOCKs — that corpus never approving is a release gate.

## Git and external actions

- Inspect the worktree before editing; preserve unrelated changes.
- Small intentional commits; never rewrite history, force-push, or delete
  branches. Remote: github.com/wonkwonlee/ChangeSafe (private) — push
  after verified milestones.
- Never commit secrets or local env files.
- Publishing packages (npm) or making the repo public requires explicit
  owner authorization.

## Scope control

When effort is constrained, priority order: (1) safety invariants and
deterministic correctness, (2) the always-working replay demo and red-team
contract, (3) the current roadmap phase's exit gate, (4) tests and build
health, (5) docs, (6) polish. The do-not-build list in
`docs/OSS_ROADMAP.md` §6 is binding.
