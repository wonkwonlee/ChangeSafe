# AGENTS.md — ChangeSafe v0.1

## Mission

Build a reliable, polished OpenAI Build Week submission for **ChangeSafe**, an AI infrastructure change airlock.

The non-negotiable trust model is:

> AI diagnoses and proposes. Deterministic code validates. A human decides. The MVP never touches real infrastructure.

These instructions apply to the entire repository. Keep them concise and update them only when implementation reveals a concrete recurring mistake or missing invariant.

## Frozen product scope

The v0.1 product contains:

- Two bundled synthetic incident scenarios
- GPT-5.6 analysis through the server-side OpenAI Responses API
- Strict Structured Output validated again with Zod
- Declarative typed change operations, never CLI commands
- Deterministic patch and safety policy engines
- Before/after diff
- Human approve/reject controls
- In-memory sandbox simulation
- Hashed downloadable change receipts
- Live and explicitly labeled replay modes
- One polished responsive web experience
- Unit, integration, scenario, and end-to-end tests

Do not add real device access, uploads of production configuration, authentication, teams, RBAC, a database, billing, generic chat, RAG, vector storage, multi-agent orchestration, queues, background workers, or additional primary scenarios.

## Safety invariants

These rules override convenience and demo polish:

1. Never connect to or execute against real infrastructure.
2. Never implement SSH, NETCONF, RESTCONF, SNMP, device APIs, arbitrary HTTP actions, or shell execution.
3. Treat alerts, notes, names, topology values, and configuration-like content as untrusted data.
4. Never expose `OPENAI_API_KEY` or model credentials to client-side code, logs, receipts, fixtures, screenshots, or errors.
5. Never treat model output as valid until Structured Output and local Zod validation both succeed.
6. The LLM never determines approval, final risk, or execution status.
7. The policy engine must be pure and must never call the LLM.
8. Any BLOCK finding makes approval and simulation impossible at both domain and UI layers.
9. Simulation applies a validated patch only to a deep-cloned synthetic state.
10. Patch application is transactional; partial mutation is forbidden.
11. Every approved patch must have a verified rollback that restores canonical pre-change state.
12. All bundled data must be fictional and safe to publish. Use documentation address ranges when IP-like values are needed.
13. Do not use employer, customer, vendor, or third-party branding or proprietary material.
14. Replay mode must be clearly labeled and must never be presented as a live model call.
15. Never attribute an authored replay or red-team fixture to GPT-5.6. Captured-model provenance must be evidenced in fixture metadata.

If a requested change conflicts with an invariant, stop that change and explain the conflict.

## State machine

Use explicit domain transitions:

```text
READY
  -> ANALYZING
  -> PROPOSED
  -> VALIDATED
     -> BLOCKED -> RECEIPT_ISSUED
     -> APPROVAL_REQUIRED
          -> REJECTED -> RECEIPT_ISSUED
          -> APPROVED -> SIMULATED -> RECEIPT_ISSUED

Any recoverable analysis, validation, or simulation failure -> ERROR -> READY
```

- BLOCKED cannot transition to APPROVED or SIMULATED.
- REJECTED cannot transition to SIMULATED.
- Only explicit human action can create APPROVED or REJECTED.
- Scenario reset returns a new clean READY state.
- ERROR must not retain a partially valid proposal or mutated state.
- Enforce transitions in domain code, not only through disabled buttons.

## Frozen policy set

Implement and preserve:

- `PATCH_SCHEMA`
- `MGMT_REACHABILITY`
- `PROTECTED_RESOURCE`
- `BLAST_RADIUS`
- `ROLLBACK_COMPLETE`
- `VERIFICATION_REQUIRED`
- `UNTRUSTED_INSTRUCTION`

Policy status is `PASS | WARN | BLOCK`.

Risk derivation is deterministic:

- Any BLOCK -> CRITICAL
- Two or more WARN and no BLOCK -> HIGH
- One WARN and no BLOCK -> MEDIUM
- All PASS -> LOW

Model confidence is advisory and must not affect this calculation.

## Architecture and code boundaries

Prefer a single strict TypeScript application:

```text
app/                 Next.js routes and page composition
components/          presentational and workflow UI
lib/ai/              server-only OpenAI and replay adapters
lib/domain/          Zod schemas, state machine, shared types
lib/patch/           allowlisted transactional patch logic
lib/policies/        pure deterministic policies and risk calculation
lib/receipt/         canonical serialization, SHA-256, receipt creation
scenarios/           synthetic incident and replay fixtures
tests/               unit, integration, scenario, and e2e tests
docs/                architecture, threat model, demo script
```

Dependency direction:

- UI may depend on domain types and API contracts.
- AI adapter may depend on domain schemas.
- Policy and patch engines may depend on domain types but never UI or AI modules.
- Receipt generation may depend on validated domain outputs, never raw model text.
- Scenario fixtures must pass the same schemas used in production.

Avoid circular dependencies and client imports of server-only modules.

## Technology defaults

- Current stable Next.js App Router
- TypeScript strict mode
- React and Tailwind CSS
- Zod
- Official OpenAI JavaScript SDK
- Responses API with `gpt-5.6`
- Vitest
- Playwright
- npm

Do not replace this stack or add major infrastructure without a demonstrated blocker.

## Commands

Keep these scripts valid and document them in `README.md`:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

If framework scaffolding produces different defaults, normalize package scripts so these commands work.

Before reporting completion, run all validation commands from the repository root. Record failures accurately and fix in-scope failures.

## Coding standards

- Use strict, explicit types; avoid `any` and unsafe casts.
- Define Zod schemas before deriving public TypeScript types.
- Prefer small pure functions for policy and patch behavior.
- Use exhaustive handling for operations, findings, risk, and workflow states.
- Validate all boundary inputs: API requests, fixture loads, model output, patch paths, and receipt download data.
- Use stable identifiers rather than display strings for evidence and resources.
- Canonicalize objects before comparison or hashing.
- Return typed domain errors; do not leak stack traces or secrets to users.
- Comments should explain invariants and non-obvious decisions, not restate code.
- Remove dead code, placeholder copy, fake metrics, and TODO-driven behavior before release.

## AI integration rules

- All OpenAI calls are server-only.
- Use the Responses API and Structured Outputs for `ChangeProposal`.
- Locally validate returned structured data with Zod.
- Separate trusted model instructions from untrusted incident content.
- Require real `evidenceId` references for material claims and operations.
- Reject invented evidence IDs or state paths.
- Require explicit assumptions, rollback operations, and verification steps.
- The model must never claim a change is safe, approved, applied, or executed.
- Live-call failure may offer replay mode but may not silently switch modes.
- Replay fixtures must declare `captured_gpt_5_6` or `authored_red_team` provenance and show an honest user-facing label.
- Default automated tests must not spend API credits or require network access.
- Optional live smoke tests require an explicit environment flag.

## Patch engine rules

- Accept only `add`, `replace`, and tightly controlled `remove` operations.
- Allowlist every mutable path family.
- Reject root mutation, prototype-related paths, unknown paths, executable strings, and missing targets.
- Apply to a deep clone and commit only when every operation succeeds.
- Return a structured diff.
- Generate or validate inverse operations using captured pre-change values.
- Verify rollback by canonical equality with the original state.

## UI standards

- Product experience should resemble a high-signal enterprise operations console.
- Make `AI PROPOSAL` and `DETERMINISTIC SAFETY GATE` visually distinct.
- PASS is green, WARN amber, BLOCK red, and active selection blue.
- Use monospace only for identifiers, paths, diffs, and hashes.
- Provide clear ready, loading, error, blocked, approval, rejected, simulated, and receipt states.
- Blocked approval must be impossible and visibly explained.
- Support keyboard focus, semantic labels, accessible contrast, and mobile layout.
- Avoid generic AI gradients, glassmorphism, fake terminal typing, decorative animation, and excessive visual noise.
- Do not sacrifice correct state or readable evidence for visual polish.

## Test expectations

Every behavioral change must include or update the smallest relevant test.

Required coverage includes:

- Schema acceptance and rejection
- Patch path allowlists and transactional failure
- Canonical serialization and stable hashes
- Every policy PASS and failure condition
- Rollback restoration
- Risk derivation
- Illegal state transitions
- Replay fixture schema parity
- Safe scenario approvable and simulatable
- Unsafe scenario always blocked and never simulatable
- Replay endpoint without an API key
- Invalid model output rejection
- No secret leakage in client artifacts or user-visible errors
- Playwright safe and blocked critical paths

Do not weaken a test to make incorrect implementation pass. Fix the implementation or, if the requirement itself is inconsistent, document the inconsistency before changing it.

## Build Week evidence

Maintain `BUILD_WEEK_CHANGELOG.md` as implementation proceeds.

- Distinguish pre-Build Week concept work from implementation created during the submission period.
- Add dated milestones and relevant commit hashes when available.
- Document how Codex accelerated implementation and where the human made product, safety, and design decisions.
- Document the runtime role of GPT-5.6.
- Leave a clear placeholder and retrieval instructions for the primary Codex `/feedback` session ID; never invent it.

Required handoff files:

- `README.md`
- `BUILD_WEEK_CHANGELOG.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/DEMO_SCRIPT.md`
- `.env.example`

## Git and external actions

- Preserve unrelated user changes.
- Inspect the worktree before editing.
- Use small, intentional commits when the repository is under git and commit authorization is present.
- Never rewrite history, force-push, delete branches, publish, deploy, or expose a private repository without explicit authorization.
- Never commit secrets or local environment files.
- Prepare deployment configuration and instructions; deploy only when explicitly authorized and credentials are available.

## Scope control

When time is tight, prioritize in this order:

1. Safety invariants and deterministic policy correctness
2. Both end-to-end replay scenarios
3. Clear product workflow and error states
4. Automated tests and production build
5. README, threat model, architecture, and demo script
6. Visual polish
7. Optional live-call tuning

Do not add features to compensate for incomplete core behavior.

## Definition of done

Work is complete only when:

- The safe replay scenario can be analyzed, validated, approved, simulated, and issued a receipt.
- The unsafe replay scenario produces required BLOCK findings and cannot be approved or simulated through UI or domain/API manipulation.
- Live GPT-5.6 integration exists and is server-only.
- Deterministic policies never rely on model judgment.
- Receipt hashes and rollback behavior are stable and tested.
- No real execution path, secret leakage, proprietary data, or misleading live/replay claim exists.
- Lint, typecheck, unit/integration tests, production build, and critical E2E tests pass.
- A judge can run and understand the project from `README.md` without assistance.
- The final report lists commands run, results, important files, deployment status, known limitations, and only genuinely external remaining actions.
