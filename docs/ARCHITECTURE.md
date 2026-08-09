# ChangeSafe Architecture

## Product surfaces and authority

ChangeSafe is library/CLI-first. The Next.js application is a multi-domain
review workbench over the same deterministic core; it is not a second policy
engine.

```text
Public browser (ephemeral)                         Self-hosted (durable)
┌───────────────────────────────┐                 ┌──────────────────────────┐
│ /                    Network │                 │ /workbench/self-hosted   │
│ /workbench/terraform         │                 │ browser client           │
│ /workbench/kubernetes        │                 └────────────┬─────────────┘
│                               │                              │ credentials:
│ POST /api/reviews/analyze     │                              │ include
│ strict V1 replay envelope     │                 ┌────────────▼─────────────┐
│                               │                 │ operator HTTPS gateway  │
│ findings + risk only          │                 │ HttpOnly session → OIDC │
│ no decision/simulation/receipt│                 └────────────┬─────────────┘
└──────────────┬────────────────┘                              │ bearer
               │                                   ┌───────────▼──────────────┐
               │                                   │ @changesafe/server       │
               │                                   │ recompute → human intent │
               │                                   │ sign → ledger append     │
               │                                   └──────────────────────────┘
        ┌──────▼──────────────────────────────────────────────────────────┐
        │ core state machine + domain adapters + deterministic policies   │
        │ no infrastructure execution path                               │
        └──────────────────────────────────────────────────────────────────┘
```

Exact `/workbench` and `POST /api/analyze` are retired compatibility paths.
`GET /api/status` remains a non-secret provider/configuration status response;
it is not a live-analysis transport.

Public replay has deliberately limited authority. It validates a fixture,
recomputes findings and risk, and renders evidence. It creates no human
decision, sandbox result, durable record, or receipt. A safe verdict means
only that the deterministic gate found no BLOCK; it is not approval.

## Module map

```text
packages/core/                 schemas, findings/risk, state machine,
                               universal policies, receipts/signatures,
                               DomainAdapter contract
packages/domain-network/       simulated-state network adapter and policies
packages/domain-terraform/     supplied external-diff adapter and policies
packages/domain-kubernetes/    offline simulated-state adapter and policies
packages/kubernetes-collector/ optional namespace-scoped read-only collector
packages/ai/                   provider adapters; proposer only
packages/ledger/               append-only SQLite receipt ledger
packages/server/               OIDC, server recomputation, decisions,
                               durable review primitives, receipt proof
packages/cli/                  gate/analyze/eval/verify/serve/collect wiring
features/domains/              strict app contracts, lazy runtime and
                               presentation registries, fixtures
features/reviews/              neutral controller, public/self-hosted
                               transports, durable review contracts
components/                    domain workbenches and shared evidence UI
app/                           route-level composition and bounded APIs
```

Dependency rules are review failures when violated:

- `packages/core` depends on Zod alone.
- A domain depends on core; it never imports React, the app, or AI.
- Nothing in the gate path depends on `packages/ai`.
- Presentation metadata stays app-local and never enters `DomainAdapter`.
- The ledger depends on core. The server depends on core, domains, and the
  ledger, never AI.
- Browser-reachable modules may not import `@changesafe/ai`, even through a
  dynamic import.
- `packages/core/src/state-machine.ts` remains the only workflow-transition
  authority.

## Domain registration and presentation

`features/domains/registry.ts` validates runtime registrations and lazy-loads
domain-specific implementations. Presentation registrations are separate:
React components and display metadata never enter the pure adapter contract.
The neutral review controller consumes versioned envelopes and dispatches
only core transitions.

Two domain shapes remain visibly distinct:

- **Simulated-state:** Network and Kubernetes apply declarative operations
  transactionally to a deep clone. The public workbench still does not run
  simulation because it has no decision authority.
- **External-diff:** Terraform receives a precomputed `terraform show -json`
  diff. ChangeSafe never runs Terraform and never claims to simulate it.
  Replaced/skipped universal policies are declared with reasons.

The future-domain contract is documented in
[`FUTURE_DOMAIN_TEMPLATE.md`](FUTURE_DOMAIN_TEMPLATE.md). A fourth test domain
proves registration and generic fallback without changing the generic shell.
IAM remains a separately specified future target, not a shipped domain.

## Public replay transport

`POST /api/reviews/analyze` accepts a strict, versioned,
domain-discriminated replay request. The route:

1. enforces a bounded request body;
2. resolves a registered domain and exact contract version;
3. loads a bundled, provenance-labeled fixture;
4. validates input/proposal references locally;
5. recomputes deterministic findings and risk;
6. returns a strict response envelope.

Unknown domains, versions, evidence, or resource references fail closed. The
route has no fields or methods for approval, simulation, execution, or receipt
issuance.

## Self-hosted boundary

`@changesafe/server` verifies OIDC bearer tokens, applies operator approver
policy, recomputes findings from submitted input/proposal, and drives the same
core state machine. A BLOCK returns conflict and is never appended as an
approval. Successful decisions are signed when a key is configured and are
appended to the hash-chained ledger before the response.

Durable review endpoints exist when `createDecisionServer` receives a
`DurableReviewStore`:

- `POST /reviews`
- `GET /reviews`
- `GET /reviews/:id`
- `POST /reviews/:id/decisions`
- `GET /reviews/:id/receipt-proof`

They are owner-scoped by verified issuer and subject. Receipt proof reports
content integrity, signature presence, out-of-band public-key verification,
and ledger inclusion independently.

`changesafe serve` constructs `DurableReviewStore` when `--reviews-db` is
passed; without that flag the vNext queue remains disabled. The queue is
therefore available as a turnkey server-side surface, but the browser still
requires an operator gateway/BFF.
The browser additionally requires an operator gateway/BFF: the public
`CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL` contains no bearer token, and the
browser uses an HttpOnly session cookie while the gateway supplies OIDC to the
server.

## Deterministic trust boundaries

1. **External content is data.** Alerts, notes, names, PR text, configuration,
   plans, and manifests are never instructions.
2. **Model output is invalid by default.** Provider-side structure is
   defense-in-depth; local strict Zod validation and reference checks decide
   acceptance.
3. **Policies own findings; core owns risk.** Model confidence and
   presentation state are absent from policy inputs.
4. **Core owns legal transitions.** Any BLOCK makes approval and simulation
   impossible regardless of UI or authentication.
5. **Simulation is local only.** Where supported, operations mutate a deep
   clone transactionally and rollback is checked canonically.
6. **Humans and existing systems execute.** No ChangeSafe endpoint or adapter
   executes infrastructure changes.
7. **Authorization is not execution.** A decision or authorization
   establishes bounded permission; it does not attest that any action
   occurred. A signed receipt records what was decided, never that
   infrastructure changed.
8. **Execution is not verified effect.** Observing or authorizing a requested
   operation does not prove the intended system state was realized.
   ChangeSafe has no observation path and issues no attestation of effect.

## Integrity and authorship

Canonical JSON uses recursively sorted keys and stable array order. Receipt
hashes prove content integrity, not authorship. Ed25519 signatures prove an
issuer only when checked against an expected public key obtained out of band.
The ledger's SQLite triggers and hash chain make alteration, deletion, and
reordering detectable; they do not provide external timestamping or
non-repudiation. 
Receipts attest decisions, not effects: no hash or signature asserts that an
approved change was applied, or that its intended state was reached.

## Kubernetes acquisition boundary

The optional collector is isolated from the gate. It rejects executable
credential plugins, performs only explicit namespace-scoped `get/list` reads,
validates a resource cap, and atomically writes a snapshot. The Kubernetes
domain consumes only offline snapshots and proposed manifests. No collector
or Kubernetes client is imported by core policies, and no manifest is applied.
