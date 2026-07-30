# G001 — Baseline and Architecture Contracts

**Parent plan:** `docs/superpowers/plans/2026-07-29-multidomain-console-vnext-ultragoal.md`

## Global constraints

- Keep `packages/core` and every `packages/domain-*` package pure and UI-free.
- Do not add React, UI metadata, browser APIs, clocks, randomness, model calls,
  credentials, or execution paths to a domain adapter or policy path.
- The core state machine remains the only authority for legal workflow
  transitions; presentation contracts may describe capabilities but may not
  derive findings, risk, approval legality, hashes, signatures, or ledger state.
- Validate every app-boundary object with strict Zod schemas. Unknown domain
  identifiers and incompatible contract versions fail closed.
- Preserve the current network replay/red-team behavior and existing API route
  during this milestone. Do not refactor `useWorkflow` or replace the UI here.
- Tests are TDD: each new behavior needs a focused test observed failing before
  implementation. Existing user-owned `.gitignore` changes remain untouched.

## Task 1 — Add app-local review contract schemas

Create the first pure, app-local contract module under `features/domains/` and
focused tests for it. This module is the shared boundary for later runtime and
presentation registrations; it is not a domain adapter and must not import
React or domain-specific UI code.

Required contracts:

- stable lower-kebab `domainId` and explicit `contractVersion`;
- `simulated-state` versus `external-diff` shape;
- a strict capability object that states simulation, resource graph, structured
  diff, untrusted-context, and durable-decision support;
- a strict public replay versus self-hosted runtime mode;
- provenance/source classification sufficient to distinguish replay, authored
  synthetic/red-team, live model, uploaded offline artifact, and read-only
  collector input;
- a strict review-session envelope whose domain, contract version, source,
  analysis mode, provenance, and simulation capability are validated;
- a safe, typed error result for an unknown domain or contract mismatch.

Acceptance criteria:

- valid Network, Terraform, and Kubernetes examples parse through one common
  envelope without importing their adapters;
- unknown keys, invalid IDs, unknown modes, and mismatched contract versions
  are rejected;
- an external-diff envelope cannot advertise sandbox simulation;
- a public replay envelope cannot claim durable decision support;
- exports are types/schemas/data only, with no React or core-policy imports.

Verification:

- focused Vitest test file for the contract module;
- `npm run typecheck` after the focused test is green.

## Task 2 — Establish a regression manifest for current network behavior

Add a focused, data-driven regression manifest and test layer that identifies
the current safe and red-team network scenarios, expected provenance, gate
outcome, risk, decision legality, and simulation eligibility. Reuse the
production scenario registry and production policy/state-machine behavior;
do not duplicate policy logic or introduce test-only production methods.

Acceptance criteria:

- the safe replay fixture proves captured provenance, LOW risk, approval
  legality, and simulation eligibility;
- the authored red-team fixture proves authored-red-team provenance, CRITICAL
  risk, BLOCK, approval prohibition, and simulation ineligibility;
- a scenario registry drift or policy regression causes a focused failure;
- assertions use literal expected outcomes rather than calling helpers under
  test to derive expectations.

Verification:

- focused Vitest test file;
- existing `tests/integration/analyze-api.test.ts` remains green.

## Task 3 — Add an architecture boundary guard

Add a repository-level test that fails if app presentation code is imported by
`packages/core` or a `packages/domain-*` package. The test must inspect only
source modules and should allow pure core/domain imports in the app. It must
not make assumptions about generated build output.

Acceptance criteria:

- imports from `features/`, `components/`, `app/`, or browser-only UI modules
  inside core/domain source fail with a clear offender path;
- the current packages pass;
- the guard is narrow enough not to reject permitted `@changesafe/core` or
  domain-to-core dependency direction.

Verification:

- focused Vitest architecture-boundary test;
- `npm test`, `npm run lint`, and `npm run typecheck` after all three tasks.
