# ChangeSafe Architecture

## System shape

One strict-TypeScript Next.js (App Router) application. No database, no
queues, no background workers. The only server-side surface is analysis; the
entire post-analysis workflow runs in shared pure domain code.

```text
┌────────────────────────── Browser ───────────────────────────┐
│  components/ (React UI)                                      │
│    useWorkflow ──dispatch──▶ lib/domain/state-machine        │
│    evaluatePolicies, runSimulation, createReceipt            │
│    (pure lib code bundled client-side; synthetic data only)  │
└───────────────┬──────────────────────────────────────────────┘
                │ POST /api/analyze { scenarioId, mode }
                │ GET  /api/status → { liveAvailable, provider, model }
┌───────────────▼───────────────── Server ─────────────────────┐
│  app/api/analyze/route.ts                                    │
│    ├─ lib/ai/replay.ts  (fixture, provenance-labeled)        │
│    └─ lib/ai/live.ts    (server-only binding)                │
│         └─ packages/ai  (OpenAI | Anthropic | Ollama)        │
│              provider credentials read here and nowhere      │
│              else; structured output + local re-validation   │
└──────────────────────────────────────────────────────────────┘
```

Why this split: the deterministic core (patch, policies, receipts, state
machine) is pure and operates on fully synthetic data, so running it in the
browser costs nothing in safety and removes any need for server session state
(serverless-safe, works identically on Vercel). The model call — the only
secret-bearing, non-deterministic step — is isolated behind one POST route,
whichever provider serves it.

## Module map and dependency direction

```text
packages/core/              proposal contract, five universal policies,
                            deterministic risk, state machine, canonical
                            serialization + SHA-256 receipts, DomainAdapter.
                            Depends on zod alone.
packages/domain-network/    device/topology model, allowlisted transactional
                            patch engine, reachability, sandboxed simulation,
                            MGMT_REACHABILITY + PROTECTED_RESOURCE
packages/domain-terraform/  plan normalization, plan-derived proposals,
                            DESTRUCTIVE_OP + PROTECTED_RESOURCE + REVERSIBILITY
packages/ai/                provider adapters (OpenAI / Anthropic / Ollama),
                            portable JSON Schema derivation, prompts,
                            local validation, capture
packages/cli/               the changesafe binary (esbuild-bundled)
lib/domain/                 app wire contracts + version
lib/ai/                     app-side binding: server-only live, replay
scenarios/                  incident bundles + replay fixtures + expectations
app/, components/           page, two API routes, UI + useWorkflow
```

Allowed dependencies (violations are review failures):

- UI → domain types, wire contracts, pure engines. UI never imports
  `packages/ai` or `lib/ai` — provider adapters are server-side.
- `packages/ai` → core + domain schemas and the patch path parser (for
  reference checks). Nothing in core or the domains imports it.
- Policy and patch engines → domain types only. **Never** UI or AI modules —
  the gate cannot consult a model by construction, and no policy function
  receives model confidence.
- Receipts → validated domain outputs only, never raw model text.
- `scenarios` fixtures parse through the production schemas at module load.

The AI package sits outside the trust chain entirely: it can propose, and
that is all. Deleting it would remove live analysis and change no verdict.

## Trust boundaries

1. **Untrusted data → model.** The incident bundle (alerts, notes, names,
   values) is data. The server prompt wraps it in `<untrusted_incident_data>`
   delimiters and instructs the model to treat embedded directives as
   observations. This is defense-in-depth only — no safety property depends
   on the model behaving.
2. **Model → deterministic core.** Model output is untrusted until (a) the
   provider's own structured-output enforcement, (b) local Zod strict parse,
   (c) evidence-id existence check, (d) device-reference check. Anything else
   is a typed error; no partial proposal survives.

   Step (a) varies by provider — OpenAI constrains generation to a strict
   `json_schema`, Anthropic to a forced strict tool call, Ollama to a
   `format` schema with looser keyword support — so it is treated as a
   quality measure, not a control. Steps (b) through (d) are identical for
   every provider and are what actually decides acceptance. The portable wire
   schema deliberately drops the length, range, and pattern keywords
   providers disagree about; Zod re-imposes all of them locally.
3. **Deterministic core → human.** Policies are pure functions; risk derives
   only from verdicts. Any BLOCK forces the `BLOCKED` state, from which
   `APPROVE` and `SIMULATION_COMPLETED` transitions throw — enforced in
   `transition()`, not in button state.
4. **Human → sandbox.** Only `APPROVED` reaches simulation; simulation
   mutates a `structuredClone` and re-evaluates declared safety properties.
   There is no code path that contacts infrastructure.

## State machine

```text
READY → ANALYZING → PROPOSED → VALIDATED
  VALIDATED → BLOCKED → RECEIPT_ISSUED
  VALIDATED → APPROVAL_REQUIRED → REJECTED → RECEIPT_ISSUED
  APPROVAL_REQUIRED → APPROVED → SIMULATED → RECEIPT_ISSUED
  {ANALYZING, PROPOSED, VALIDATED, APPROVED} → ERROR (safe message only)
  any state → RESET → fresh READY
```

`CLASSIFY` (VALIDATED → BLOCKED | APPROVAL_REQUIRED) derives from findings
inside the machine — callers cannot pick the branch. `APPROVE` re-checks
findings for BLOCK as defense in depth. `ERROR` retains no proposal or
findings.

## Canonicalization and hashing

`lib/receipt/canonical.ts` serializes with recursively sorted keys (code-unit
order), arrays in order, `undefined` dropped, non-plain objects rejected.
Uses: rollback verification (canonical equality) and SHA-256 hashing
(WebCrypto, identical in Node and browsers). The receipt's `receiptSha256`
covers the canonical receipt minus the hash field itself.

## Reachability model

Deliberately simple and fully deterministic: a link is traversable when its
topology status ≠ down and both endpoint interfaces are enabled; a device
that models routes participates in forwarding toward a target only if some
route covers the target's management IP (devices with zero routes are
passive); the target must hold a covering route back to the origin. This is
enough to make "removing the only management route severs access" provable on
a sandboxed copy, which is the property the demo depends on.
