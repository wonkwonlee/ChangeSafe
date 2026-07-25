# ChangeSafe — Build Week Changelog

> **Historical record (closed 2026-07-25).** ChangeSafe v0.1 was built
> during the OpenAI Build Week 2026 window but was ultimately **not
> submitted** due to time constraints. The project has pivoted to an
> independent open-source effort — see `docs/OSS_ROADMAP.md` for the
> current direction. The submission checklist below is retained as-is for
> historical accuracy and is no longer actionable.

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
- **M3 — GPT-5.6 server-only integration** (commit `6f4f2af`):
  - Hardened instructions + `<untrusted_incident_data>` delimiters; the model
    is told incident content is data, must cite real evidence ids, must
    provide rollback + verification, and may never claim safety/approval.
  - Live adapter: OpenAI Responses API with Structured Outputs
    (`zodTextFormat` over `ChangeProposalSchema`, `reasoning.effort: low`).
    Local re-validation rejects schema mismatches, invented evidence ids, and
    unknown device references; upstream failures map to typed errors carrying
    status codes only (no secrets).
  - `POST /api/analyze` (replay fully functional without a key; live returns
    safe 502/503s offering an explicit replay switch) and `GET /api/status`
    (`liveAvailable` boolean only). Request bodies strictly validated with a
    size cap.
  - Opt-in `CHANGESAFE_LIVE_SMOKE=1` smoke test; `CHANGESAFE_CAPTURE_FIXTURE=1`
    writes a provenance-stamped captured fixture for owner review. 128 tests
    green (live smoke skipped by default).
- **M4 — Complete one-page UI** (commit `ae9245e`):
  - Dark operations console: incident evidence column (alert timeline,
    topology SVG, current-state tree, operator notes visibly labeled
    "untrusted input") beside a numbered airlock rail of five stages.
  - Authority color-coding: violet = AI proposal, steel frame = deterministic
    safety gate, blue = human activity, green/amber/red = verdicts. Model
    confidence rendered as advisory-only.
  - Blocked proposals disable approval with an explanation of the domain-level
    enforcement; every outcome ends in a hashed, downloadable receipt.
  - Verified manually in the browser (Playwright-driven): scenario A full
    approve → simulate → receipt; scenario B blocked → blocked receipt; no
    horizontal overflow at 390 px; zero console errors.
- **M5 — E2E and quality gate** (commit `dd82b64`):
  - Playwright critical paths (replay, keyless): safe flow to a
    content-verified downloaded receipt; blocked flow with disabled approval
    and blocked receipt; reset/scenario-switch cleanliness.
  - Client-bundle grep proves `OPENAI_API_KEY` and server prompt strings are
    absent from `.next/static`.
  - Full gate green: `lint`, `typecheck`, `test` (128 passing, live smoke
    skipped by default), `build`, `test:e2e` (3 passing).
- **M6 — Build Week handoff** (commit `b0844f2`):
  - `README.md` (judge-runnable quickstart, replay/live instructions,
    runtime GPT-5.6 role, human decisions, limitations, Vercel steps),
    `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/DEMO_SCRIPT.md`
    (≤2:30, unsafe-first, mentions Codex and GPT-5.6).
  - Review sweeps: no TODO-driven behavior, no execution libraries, no
    console noise in product code, documentation-range addresses only.
  - Clean-install verification: `npm ci` → lint, typecheck, test, build,
    e2e all green from scratch.
  - Independent safety review (separate reviewer agent) verified ten
    invariant claims against the code — blocked-never-approvable, pure
    policies, server-only key, transactional patches, dual model-output
    validation, honest provenance, findings-only risk, self-excluding
    receipt hash, no execution surface, deterministic-core correctness —
    all held. Its one MINOR finding (a latent invalid inverse for
    routing-preference `add` in the unused `deriveInverseOperations`
    branch) was fixed fail-closed with two pinning tests (130 tests).
  - Screenshots added to README; receipt view verified overflow-free at
    390 px.

## Submission checklist (owner)

- [ ] Record the demo video from `docs/DEMO_SCRIPT.md` (≤3:00).
- [ ] Fill in the Codex usage paragraph in `README.md` and this file, and
      replace `TODO-OWNER-INSERT` above with the primary Codex `/feedback`
      session ID (run `/feedback` in your Codex session and copy the ID —
      never guess it).
- [ ] Optional: with an `OPENAI_API_KEY`, run
      `CHANGESAFE_LIVE_SMOKE=1 CHANGESAFE_CAPTURE_FIXTURE=1 npm test`,
      review `scenarios/scenario-a-failover/replay-fixture.captured.json`,
      and promote it to `replay-fixture.json` for genuine
      `captured_gpt_5_6` provenance in the safe scenario.
- [ ] Deploy to Vercel (`vercel --prod`; replay mode needs no env vars) and
      verify both scenarios on the public URL.
- [ ] Push the repository to a public remote and attach the URL + deployment
      link to the submission before July 21, 5:00 PM PDT.
