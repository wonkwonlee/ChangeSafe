# Multi-Domain Console vNext — Ultragoal Plan

**Date:** 2026-07-29

**Branch:** `codex/multidomain-console-vnext`

**Design:** `docs/superpowers/specs/2026-07-29-multidomain-console-vnext-design.md`

## Objective

Rewrite ChangeSafe as a new, long-lived multi-domain Change Review Workbench
that supports Network, Terraform, Kubernetes, IAM, and future infrastructure
domains without branching the generic shell or weakening deterministic
authority.

The first implementation wave delivers Network, Terraform, and Kubernetes.
IAM remains the explicit post-vNext extensibility target; it receives a
separate domain specification after G008 proves that a fourth domain can be
registered without changing the generic shell.

The public runtime remains a keyless, ephemeral artifact/replay experience.
The self-hosted runtime may add authenticated queues, server-recomputed
decisions, signed receipts, and ledger history. Neither runtime executes
infrastructure changes.

## Architecture Invariants

1. Core and domain policy packages remain pure and UI-free.
2. React presentation metadata never enters `DomainAdapter`.
3. The core state machine remains the only authority for legal workflow
   transitions.
4. Findings, risk, approval legality, hashes, signatures, and ledger status are
   never derived from presentation state.
5. BLOCK remains unapprovable in UI and domain/server logic.
6. Simulated-state and external-diff domains remain visibly and behaviorally
   distinct.
7. The browser receives no infrastructure credentials or execution path.
8. Live model output, captured replay, authored synthetic, authored red-team,
   offline input, hashes, signatures, verification, and ledger inclusion retain
   honest independent labels.
9. The existing network replay, red-team refusal, and receipt contracts remain
   green until the replacement proves parity.
10. Adding a future domain requires a pure domain adapter, validated runtime
    registration, presentation registration, fixtures, and contract/E2E tests;
    it does not require generic shell changes.

## Delivery Model

- Work is delivered in independently reviewable vertical slices.
- The legacy UI stays deployable until the final cutover.
- No major dependency is added without a dependency and accessibility review.
- Every behavioral story adds the smallest relevant tests.
- The final story runs the complete repository gate plus the Ultragoal cleanup,
  invariant-audit, and independent-review gate.

### Stories

#### G001 — Baseline and architecture contracts

Lock the existing network safe, warning, blocked, reset, provenance, receipt,
and secret-boundary behavior. Define validated runtime, presentation,
capability, review-session, review-record, transport, and versioned API
contracts. Add architecture tests proving that presentation code cannot enter
core/domain policy packages.

#### G002 — Product design system and application shell

Build the semantic token system, accessible primitives, capability-aware
navigation, Review Queue/Examples runtime variants, responsive layout,
Authority Spine, outcome header, evidence canvas, and decision rail using
static validated fixtures. Establish visual-regression and accessibility
baselines.

#### G003 — Domain registry and domain-neutral orchestration

Replace the network-bound controller with surface-specific runtime and
presentation registries. Implement a domain-neutral review orchestrator driven
only through core transitions and validated runtime transports. Add
domain-discriminated, versioned API envelopes while retaining the legacy
network endpoint for parity.

#### G004 — Network parity migration

Port all network examples, evidence, topology, current state, proposals,
findings, decisions, simulations, and receipts into the new workbench. Prove
byte-level outcome/hash and visible provenance parity for the existing safe and
red-team E2E paths before removing any old network component.

#### G005 — Terraform external-diff vertical slice

Add Terraform plan ingestion, module/resource navigation, action and value
diffs, protected/stateful emphasis, reversibility evidence, and destructive
fixtures. The workbench must label Terraform as a supplied external diff and
must expose no simulation action.

#### G006 — Kubernetes simulated-state vertical slice

Add offline snapshot plus YAML/JSON manifest review, namespace/resource and
Service-selector views, availability/security/image/protected-resource
evidence, sandbox simulation, and safe/blocked/unsupported/adversarial E2E
fixtures. No browser or gate path may contact a cluster or apply a manifest.

#### G007 — Runtime modes, intake, queue, and receipt proof

Implement capability-driven public replay and self-hosted transports. Add
domain-aware intake, durable review-record behavior only where supported,
server-recomputed decisions, and receipt detail that distinguishes content
integrity, signature presence, out-of-band verification, and ledger inclusion.

#### G008 — Policy coverage, sources, and future-domain template

Add policy order/version/pack/skipped-policy/limitation views and source
capability disclosures. Provide a documented future-domain template, generic
fallback renderer, and contract test proving a fourth domain can be added
without generic shell changes. This is the extensibility proof for a later IAM
domain, not a production IAM implementation.

#### G009 — Accessibility, responsive, performance, and security hardening

Meet WCAG 2.2 AA, keyboard, focus, reduced-motion, 200% zoom, responsive,
graph-table equivalence, large-fixture, code-splitting, telemetry privacy,
upload-limit, safe-error, and client-secret-canary contracts across supported
browsers and runtime modes.

#### G010 — Cutover, documentation, and final quality gate

Run full parity and regression verification, remove compatibility routes and
legacy UI only after evidence is clean, update README/screenshots/architecture/
threat model/operator documentation, and pass the mandatory changed-file
cleanup, post-cleanup verification, architecture-invariant audit, independent
code-reviewer APPROVE, and architect CLEAR gates.

## Global Verification

```bash
npm run lint
npm run typecheck
npm run build:packages
npm run build:cli
npm test
npm run build
npm run test:e2e
```

## Planning Gate

This plan and its generated Ultragoal artifacts may be committed and mirrored
to GitHub issues now. Implementation begins only after owner review of the
design specification and this story sequence.
