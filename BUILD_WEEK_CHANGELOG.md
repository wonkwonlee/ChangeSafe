# ChangeSafe — Build Week Changelog

Submission window: July 13 – July 21, 2026 (5:00 PM PDT). Track: Developer Tools.

## Prior work vs. Build Week implementation

- **Before the window:** ChangeSafe existed only as a product concept and a written
  specification (`CLAUDE.md` / `AGENTS.md` repository instructions). No application
  code, schemas, tests, or fixtures existed.
- **During the window:** every line of implementation in this repository —
  domain schemas, state machine, patch/policy/receipt engines, scenarios,
  GPT-5.6 integration, UI, and tests — was created from scratch, AI-accelerated
  under human product/safety direction.

## Runtime role of GPT-5.6

GPT-5.6 (OpenAI Responses API, server-only, Structured Outputs) interprets a
synthetic incident bundle and produces a typed `ChangeProposal`: diagnosis with
evidence citations, declarative change operations, rollback operations, and
verification steps. It never validates, approves, executes, or scores risk —
deterministic local code does that, and a human makes the decision.

## Codex usage

<!-- PLACEHOLDER (owner action): summarize in your own words how Codex was used
     to accelerate implementation during Build Week, and paste the primary
     Codex /feedback session ID below. To retrieve it: in the Codex CLI session
     you used for this project, run /feedback and copy the session ID it
     prints. Do not guess or invent the ID. -->

Primary Codex `/feedback` session ID: `TODO-OWNER-INSERT`

## Dated milestones

### 2026-07-19

- **M0 — Repository and contracts** (commit `9caf818`):
  - Initialized git repository and Next.js 16 + TypeScript strict + Tailwind v4
    scaffold with normalized scripts (`dev`, `lint`, `typecheck`, `test`,
    `build`, `test:e2e`).
  - Implemented the full Zod domain layer (`lib/domain/schemas.ts`):
    IncidentBundle, ChangeProposal (Structured-Outputs-strict compatible),
    PolicyFinding, ReplayFixture with honest provenance rules, SimulationResult,
    ChangeReceipt with cross-field invariants.
  - Implemented the explicit workflow state machine with typed
    `IllegalTransitionError` (BLOCKED can never approve/simulate; ERROR retains
    no partial proposal).
  - Unit smoke tests for schema acceptance/rejection and every legal/illegal
    transition family.
- **M1 — Deterministic safety core** (commit `41b9db0`):
  - Transactional patch engine over a four-family path allowlist
    (`interface enabled`, `route add/remove`, `route metric`,
    `routing preference`) with typed failures, structured diffs, and
    executable-string screening.
  - Canonical serializer (sorted keys, locale-independent) + SHA-256 helpers.
  - Inverse-operation derivation and rollback verification by canonical
    equality on sandboxed copies.
  - All seven frozen policies implemented as pure, independently fail-closed
    functions; deterministic risk derivation (BLOCK→CRITICAL, 2×WARN→HIGH,
    1×WARN→MEDIUM, else LOW); no policy consults the model.
  - Sandboxed simulation engine re-evaluating declared safety properties.
  - Receipt builder: incident/proposal hashes plus a self-hash computed over
    the canonical receipt excluding the hash field. 98 unit tests green.
- **M2 — Scenarios, replay fixtures, contract tests** (commit `f9ad5cd`):
  - Scenario A "INC-4821 — Degraded primary uplink" (safe failover) and
    Scenario B "INC-4977 — Suspected route leak" (red-team, with a prompt
    injection embedded in an operator note). Fully synthetic data using
    documentation address ranges only.
  - Replay fixtures with honest provenance (`authored_synthetic` /
    `authored_red_team`, `model: null`) validated by production schemas at
    module load.
  - Evidence-id cross-validation (`EVIDENCE_UNKNOWN`) rejects invented
    citations before any policy or patch processing.
  - Contract tests: A approvable → simulatable → verified receipt; B always
    produces the required BLOCKs and WARN, derives CRITICAL, and can never be
    approved or simulated at the domain layer. 110 tests green.
