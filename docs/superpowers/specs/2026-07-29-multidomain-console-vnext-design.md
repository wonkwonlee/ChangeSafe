# ChangeSafe Multi-Domain Console vNext

**Date:** 2026-07-29

**Status:** Proposed for owner review

**Branch:** `codex/multidomain-console-vnext`

**Scope:** Full product UI/UX rewrite and scalable multi-domain frontend architecture

## Decision

Rewrite the current single-page showcase as a new product experience:
**ChangeSafe Review Workbench**.

The workbench is a domain-aware interface for reviewing one proposed
infrastructure change from evidence through deterministic validation, human
decision, optional sandbox simulation, and receipt. It is not a monitoring
dashboard, a generic chat interface, or an infrastructure control plane.

The implementation will replace the current page composition and visual
system, but it will preserve the existing deterministic authority:

> AI proposes. Deterministic code validates. A human decides. ChangeSafe
> never executes changes against infrastructure.

The rewrite must make it possible to add Network, Terraform, Kubernetes, IAM,
and future domains without adding domain conditionals throughout the shell.

The first implementation wave delivers Network, Terraform, and Kubernetes.
IAM is the named post-vNext extensibility target, not a hidden commitment to
ship a production IAM adapter inside this rewrite. G008 proves the fourth-
domain integration path with contracts and a generic fallback before an IAM
domain is separately specified.

## Why a Full Rewrite

The current interface is effective as a focused network demo, but its product
model is encoded directly in the page:

- `ChangeSafeApp` owns one long five-stage rail.
- `useWorkflow` imports the network adapter, network simulation, and
  `IncidentBundle`.
- the analyze API validates only a network proposal;
- the scenario registry contains only network incidents;
- the evidence, topology, state, and proposal preview panels are network
  components;
- Terraform cannot honestly fit the mandatory simulation stage because it is
  an external-diff domain;
- Kubernetes has a pure domain adapter but no browser presentation or input
  path.

Adding domain-specific branches to this structure would produce a growing set
of exceptions. The new product instead treats the review workflow as the
stable shell and each infrastructure domain as a registered runtime plus a
registered presentation.

## Product Position

### Primary job

Help a platform engineer or change reviewer answer four questions:

1. What evidence and proposed change are being reviewed?
2. Which deterministic policies passed, warned, or blocked?
3. What decision is a human allowed to make?
4. What verifiable record was produced?

### Primary users

- platform and infrastructure engineers reviewing AI-proposed changes;
- security or reliability reviewers validating high-risk changes;
- maintainers evaluating synthetic scenarios and red-team fixtures;
- self-hosters reviewing authenticated decisions and receipts.

The long-term product distinguishes capabilities without inventing an
infrastructure executor role:

- **submitter/source** supplies artifacts or proposals but cannot decide;
- **reviewer** investigates evidence and findings;
- **approver** records a human approval or rejection only when legal;
- **policy owner** manages typed pack parameters but cannot override BLOCK or
  the core risk formula;
- **auditor** inspects receipts, signatures, and ledger health without decision
  permission;
- **integration administrator** configures read-only ingestion, identity, and
  signing boundaries but never infrastructure write access.

### Runtime modes

The UI supports two explicit runtime modes:

- **Public replay workbench:** keyless, ephemeral, synthetic or uploaded
  offline artifacts, local deterministic evaluation, no durable history.
- **Self-hosted workbench:** authenticated identity, server-recomputed
  findings, signed receipts, and ledger-backed history.

Runtime mode is a capability supplied at the composition boundary. Components
must not scatter environment-variable or deployment checks.

### Non-goals

- live infrastructure monitoring;
- applying or executing a change;
- storing kubeconfig, cloud credentials, Terraform credentials, or device
  credentials in the public app;
- direct Kubernetes, Terraform, network-device, IAM, or cloud API access from
  the browser;
- generic chat, RAG, incident management, billing, or multi-tenant marketplace
  features;
- a policy-authoring DSL;
- making the UI an authority over risk, approval, or execution.

## Approaches Considered

### A. Add domain tabs to the existing page

This is the fastest path, but it preserves the network-bound controller and
adds branches for every evidence shape, proposal preview, and simulation
behavior. It is rejected because the cost of each future domain would grow.

### B. Build separate applications for each domain

This gives every domain complete freedom, but duplicates the authority model,
decision workflow, receipts, accessibility work, and visual language. It is
rejected because divergence would make safety behavior harder to verify.

### C. Shared workbench plus domain plugins

One product shell owns navigation, authority, decision, findings, receipts,
and runtime mode. Registered domain modules own input parsing integration,
domain capabilities, view-model creation, and domain visualizations.

This is the selected approach.

## Information Architecture

### Global navigation

The application shell contains:

- **Review queue** — self-hosted cross-domain work requiring attention;
- **Changes** — submitted, failed-to-evaluate, blocked, decided, and archived
  review records;
- **Workbench** — start or continue one change review;
- **Examples** — domain-grouped synthetic scenarios and fixtures;
- **Receipts** — visible only when the runtime supplies durable receipt
  storage;
- **Policy coverage** — effective order, versions, packs, skipped policies,
  replacements, and domain limitations;
- **Sources** — artifact, CI, collector, fixture, model, and identity
  integrations with explicit read/write capabilities;
- **Trust model** — concise in-product explanation linking to architecture and
  threat-model documentation.

Settings for identity, signing, retention, and accessibility appear only when
the runtime implements them. The public deployment does not show an empty fake
queue or history screen. Capabilities that do not exist in a runtime are
absent with an explicit runtime explanation where needed. Synthetic and replay
records never appear indistinguishably in an operational queue.

### Routes

```text
/                              product entry and domain/source selection
/reviews                       cross-domain queue when persistence exists
/reviews/new                   domain-aware input flow
/reviews/[reviewId]            review workbench
/changes                       searchable review history when persistence exists
/examples                      filterable multi-domain example library
/receipts/[receiptId]          receipt detail when durable storage is available
/policies                      policy coverage and version evidence
/sources                       read-only source and integration capabilities
```

Raw artifacts, credentials, and secrets never appear in URLs. Public replay
review identifiers are ephemeral references to in-memory validated data.

### Review workbench

The desktop workbench uses three coordinated regions:

1. **Context rail**
   - domain and source;
   - runtime and provenance;
   - resource/evidence navigation;
   - untrusted-content markers.
2. **Review canvas**
   - summary;
   - evidence;
   - proposed change and diff;
   - domain visualization;
   - simulation or external-impact view.
3. **Authority rail**
   - deterministic policy counts and risk;
   - current workflow phase;
   - blocking explanations;
   - human decision controls;
   - receipt state.

The current long vertical rail becomes a persistent **Authority Spine**. The
workflow remains sequential in code, while progressive disclosure reduces the
amount of information presented at once.

The spine shows seven independently sourced claims:

1. **Input** — untrusted artifact or source;
2. **Proposal** — model, authored fixture, derived external diff, or supplied
   proposal;
3. **Gate** — deterministic policy version, pack, findings, and risk;
4. **Human** — pending, approval permitted, approval prohibited, approved, or
   rejected;
5. **Effect proof** — sandbox simulation, supplied external diff, unavailable,
   or not applicable;
6. **Record** — hash, signature, signature verification, and ledger inclusion
   as separate claims;
7. **Execution** — permanently labeled outside ChangeSafe and not observed.

### Outcome-first hierarchy

After evaluation, the first viewport must show:

- domain and source identity;
- proposal provenance;
- PASS/WARN/BLOCK counts;
- deterministic risk level;
- whether human approval is permitted;
- whether simulation is supported or intentionally inapplicable.

Model confidence remains visually subordinate and is always labeled advisory.
The scan-level result should be understandable within ten seconds. BLOCK and
WARN details expand by default; PASS evidence and raw artifacts are available
at review and proof depths.

## Domain Architecture

### Separate runtime from presentation

The core `DomainAdapter` remains pure and UI-free. React components, labels,
icons, layout hints, and visualization preferences must never be added to
`@changesafe/core` or domain policy packages.

Each domain is composed from two independent registrations.

#### Domain runtime

The runtime registration owns validated behavior:

```ts
interface ReviewDomainRuntime<TInput> {
  readonly id: string;
  readonly adapter: DomainAdapter<TInput, unknown>;
  readonly shape: "simulated-state" | "external-diff";
  parseInput(raw: unknown): { input: TInput; inputId: string };
  resolveProposal(input: TInput, raw: unknown): ChangeProposal;
  simulate?(input: TInput, proposal: ChangeProposal): SimulationResult;
}
```

The actual implementation must avoid `any` and unsafe casts. Registry type
erasure occurs only behind a validating closure: unknown input is parsed
before a runtime method can observe it.

#### Domain presentation

The presentation registration owns product meaning and renderers:

```ts
interface ReviewDomainPresentation<TInput> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly capabilities: DomainUiCapabilities;
  summarize(input: TInput): ReviewSummary;
  evidence(input: TInput): EvidenceViewModel;
  change(input: TInput, proposal: ChangeProposal): ChangeViewModel;
  impact(
    input: TInput,
    proposal: ChangeProposal,
    simulation: SimulationResult | null,
  ): ImpactViewModel;
  readonly views: DomainViewSlots;
}
```

The exact generic shape may be refined during implementation, but these
boundaries are mandatory:

- runtime validation and policy evaluation do not import React;
- presentation code cannot implement or override a policy;
- the shell consumes common summaries and explicit renderer slots;
- unsupported capabilities are data, not exceptions hidden in components.

### Domain capabilities

Capabilities are explicit and validated:

- domain shape: simulated-state or external-diff;
- accepted input sources and file formats;
- proposal source: supplied, derived, live model, replay fixture;
- simulation support;
- resource graph support;
- structured diff support;
- untrusted context support;
- durable decision support for the active runtime.

The shell uses these capabilities to select honest language. Terraform shows
an external plan impact view and never pretends that ChangeSafe simulated
Terraform. Network and Kubernetes may show sandbox results produced from deep
clones.

### Domain modules

App-specific domain modules live outside the pure domain packages:

```text
features/domains/
  registry.ts
  network/
    runtime.ts
    presentation.ts
    views/
  terraform/
    runtime.ts
    presentation.ts
    views/
  kubernetes/
    runtime.ts
    presentation.ts
    views/
```

### Current repository to target layout

The rewrite is an in-place frontend migration, not a monorepo restructure:

| Current surface | Target responsibility |
| --- | --- |
| `app/page.tsx` | URL-aware entry into the new product shell |
| `components/ChangeSafeApp.tsx` | decomposed into shell, workbench, and route-level compositions |
| `components/useWorkflow.ts` | replaced by a domain-neutral review orchestrator |
| `components/IncidentPanel.tsx`, `TopologyView.tsx`, `StateTree.tsx` | moved behind the Network presentation registration |
| `components/ProposalPanel.tsx` | split into shared proposal chrome plus domain change-set renderers |
| `lib/domain/api.ts` | versioned, domain-discriminated transport envelopes |
| `app/api/analyze/route.ts` | compatibility route, then registry-backed domain analysis transport |
| `scenarios/index.ts` | domain-aware example catalog with schema-validated entries |
| `components/PolicyGate.tsx`, `DecisionBar.tsx`, `ReceiptPanel.tsx` | retained concepts with domain-neutral terminology and corrected proof claims |

Pure packages under `packages/core` and `packages/domain-*` remain in place.
The target `features/domains/` tree is an app-local presentation/composition
boundary and does not replace the domain packages.

Adding a future IAM domain requires:

1. a pure domain package implementing `DomainAdapter`;
2. a runtime registration with boundary schemas;
3. a presentation registration and view slots;
4. scenario or artifact fixtures;
5. shared contract tests and domain-specific E2E coverage.

It must not require changes to core policies or the generic workbench
components.

## Workflow and Data Flow

### Review record versus receipt

A self-hosted queue requires a durable review record that is distinct from the
final receipt:

- the review record tracks validated source metadata, workflow phase,
  assignment, freshness, and safe error state;
- the receipt records a completed gate/decision outcome and its integrity
  evidence;
- changing queue metadata cannot rewrite a receipt;
- a public replay session is ephemeral and does not claim to be a durable
  review record.

Persistence for review records is a separate implementation decision inside
the existing self-hosted boundary. The UI rewrite does not introduce a new
database or multi-tenant platform.

### Review session

A review session is a validated, domain-tagged object:

```text
source selected or artifact uploaded
  -> domain runtime validates and normalizes input
  -> proposal is replayed, uploaded, derived, or produced by an optional model
  -> deterministic policies evaluate through the domain adapter
  -> core state machine classifies BLOCK or APPROVAL_REQUIRED
  -> a human decision event is accepted only when legal
  -> optional domain simulation runs only after approval
  -> a receipt is created or requested from the self-hosted server
```

The UI never derives a workflow phase from text, color, route, or component
visibility. It renders the phase returned by the core state machine.

### Evaluation transports

The controller depends on a runtime transport rather than calling one fixed
route:

- `PublicReplayTransport` performs validated, keyless local/replay work;
- `SelfHostedDecisionTransport` calls the authenticated server, which
  recomputes findings and signs/records the receipt.

Both transports return the same validated review result envelope. The public
transport must never be presented as an authenticated decision service.
Presentation components never calculate findings, risk, workflow legality, or
hashes. Public orchestration may call the imported pure core functions; the
self-hosted transport treats server recomputation as authoritative.

### API contracts

All wire envelopes carry a domain discriminator and version:

```text
domainId
contractVersion
source
analysisMode
provenance
proposal
findings
riskLevel
simulationCapability
```

The server resolves `domainId` through a closed registry and validates input
and proposal with that domain's schemas. Unknown domains or incompatible
contracts fail closed with safe error messages.

The current network analyze route remains available during migration until
the new route has parity tests. Compatibility is removed only in the final
cutover milestone.

## Domain Experiences

### Network

- alert and note timeline;
- topology and management-reachability graph;
- device, interface, route, and protected-resource state;
- operation diff and rollback;
- sandbox reachability and declared safety properties.

### Terraform

- plan metadata and resource-change summary;
- resource hierarchy grouped by module/provider/type;
- create/update/replace/delete diff;
- protected and stateful resource emphasis;
- destructive-operation and reversibility explanations;
- explicit statement that the plan is the external diff and no ChangeSafe
  simulation ran.

### Kubernetes

- namespace and supported-kind inventory;
- workload-to-Service selector relationships;
- current snapshot versus proposed manifest diff;
- replicas, rollout availability, container security, images, and protected
  resource emphasis;
- sandbox safety-property results;
- explicit offline snapshot provenance and statement that no manifest was
  applied and no Kubernetes API was contacted by the gate.

### Future fallback

An unfamiliar registered domain must remain reviewable through generic
resource, evidence, typed-operation, finding, limitation, and receipt views
even before it has a custom graph. A missing visualization never becomes a
missing verdict.

## Design System

### Principles

- **Authority before decoration.** AI, deterministic gate, and human actions
  have distinct and consistent semantic treatments.
- **Outcome before detail.** Review status is readable before expanding
  evidence.
- **Dense but calm.** Infrastructure data may be compact, but primary actions
  and blocking findings are never visually crowded.
- **Provenance is visible.** Live, captured replay, authored synthetic, and
  authored red-team content are distinguishable without opening metadata.
- **No color-only meaning.** Every status has text and shape/icon support.
- **Identifiers remain exact.** Paths, hashes, evidence ids, and resource ids
  use monospace and remain copyable.
- **Claims remain separate.** Gate passed is not approved; approved is not
  executed; simulated is not deployed; hashed is not signed; signed is not
  signature-verified; signature-verified is not ledger-verified.

### Tokens and themes

Replace direct utility combinations with semantic component tokens:

- canvas, surface, elevated, overlay, and border layers;
- primary and neutral actions;
- AI/provenance, deterministic authority, and human-decision accents;
- PASS, WARN, BLOCK, and informational status;
- typography, density, spacing, radius, focus, and motion.

The token system is theme-capable. Dark remains the initial operational
default; a light theme can be implemented without changing component
semantics.

### Component families

- application shell and navigation;
- review header and authority strip;
- status, risk, provenance, domain, and runtime badges;
- resizable context/canvas/authority regions;
- tabs, disclosure sections, filters, and search;
- evidence timeline and source references;
- resource tree, topology graph, relationship graph, and accessible table
  fallback;
- structured/code diff;
- policy finding list and remediation details;
- decision dock and confirmation boundary;
- receipt detail and verification actions;
- empty, loading, unsupported, error, and fail-closed states.

Complex primitives must be keyboard accessible. Any new third-party UI
dependency requires a separate dependency review for maintenance,
accessibility, bundle size, and license before adoption.

Decision actions use **Record approval** and **Record rejection**. The
confirmation boundary repeats that the action records a human decision and
does not apply, deploy, or execute the reviewed change.

## Responsive and Accessibility Contract

- desktop supports the three-region workbench;
- tablet collapses the context rail into a drawer and keeps the authority rail
  visible;
- mobile uses one ordered column: outcome, findings, evidence/change,
  decision, receipt;
- approval controls never appear before blocking findings in the mobile
  reading order;
- graphs have equivalent structured tables or lists;
- keyboard navigation covers every control and disclosure;
- focus is persistent and visible;
- reduced-motion preferences remove nonessential motion;
- status changes use appropriate live regions without repeating the full page;
- text and interactive contrast meets WCAG 2.2 AA;
- zoom to 200% does not hide the decision boundary or require two-dimensional
  page scrolling.

## Failure and Safety UX

- validation errors name the rejected artifact type without echoing secrets or
  raw hostile content;
- unknown domain, contract mismatch, model failure, and simulation failure
  never become a PASS state;
- a blocked review has no enabled approval control;
- an external-diff domain has no simulate action;
- a transport failure drops partial proposal state according to the core state
  machine;
- self-hosted signing or ledger failure produces no successful decision
  response;
- receipt presentation reports content integrity, signature presence,
  out-of-band signature verification, and ledger inclusion independently and
  never collapses them into one “verified” badge;
- unsupported input kinds are rejected at ingestion, before a workbench review
  appears valid;
- untrusted text remains visually marked as data throughout evidence and
  proposal views.

## Performance Contract

- first product shell render does not load all domain visualizations;
- domain view modules are loaded by registered route/domain;
- large evidence sets and resource trees use bounded rendering or
  virtualization only after measured need;
- raw artifact text is not duplicated into multiple client states;
- expensive view models are pure, memoizable, and independently tested;
- performance budgets are recorded for JavaScript, initial render, review
  interaction, and large-fixture behavior before cutover;
- telemetry never records artifact contents, proposal contents, secrets, or
  receipts.

## Migration Strategy

The rewrite is isolated on the feature branch and delivered through vertical
slices. The existing public experience stays deployable until cutover.

### M1 — Architecture and regression baseline

- lock existing safe, blocked, reset, provenance, and receipt behavior;
- define runtime, presentation, capability, review-session, and transport
  contracts;
- add architecture tests proving UI packages cannot influence core policies.

### M2 — Design system and product shell

- implement tokens and accessible primitives;
- implement navigation, source selection, review route, outcome header, review
  canvas, and authority rail using static fixtures;
- establish responsive and visual-regression baselines.

The shell includes the Authority Spine, capability-aware navigation, and
separate receipt-proof states.

### M3 — Domain-neutral workflow

- replace the network-specific controller with a registry-backed review
  controller;
- introduce versioned domain-aware API envelopes;
- preserve the legacy network route until parity is proven.

### M4 — Network migration

- port all current scenarios and both critical E2E paths;
- reproduce findings, risk, legal decisions, simulation, receipts, hashes, and
  provenance exactly;
- remove old network-only panels only after parity evidence.

### M5 — Terraform vertical slice

- add artifact ingestion and external-diff presentation;
- prove that the workbench handles a domain with no simulation;
- cover benign and destructive fixtures in E2E.

### M6 — Kubernetes vertical slice

- add offline snapshot plus manifest ingestion;
- add resource, selector, security, image, and availability visualizations;
- cover safe, blocked, unsupported, and simulation-flagged fixtures;
- keep collectors and cluster credentials outside the browser.

### M7 — Runtime modes and receipts

- integrate public replay and self-hosted decision transports;
- expose authenticated identity and signed/ledger-backed receipt evidence only
  in self-hosted mode;
- verify that runtime capability changes do not change policy outcomes.

### M8 — Hardening and cutover

- run accessibility, responsive, performance, browser, security, and visual QA;
- verify client bundles contain no secret canaries;
- remove compatibility routes and legacy UI only after all parity gates pass;
- update screenshots, README, architecture, threat model, and operator
  documentation.

## Verification Strategy

### Contract tests

- every registered runtime id has one matching presentation id;
- every runtime validates before evaluating;
- simulated-state domains provide simulation; external-diff domains cannot;
- domain registration cannot change risk derivation or legal transitions;
- every view model rejects unvalidated input.

### Component and accessibility tests

- design-system primitives and authority states;
- keyboard and screen-reader behavior;
- graphs and tables carry equivalent meaning;
- decision controls are absent or disabled for BLOCK;
- provenance and runtime mode are always visible.

### Integration tests

- versioned API envelopes for each domain;
- public replay versus self-hosted recomputation;
- upload limits and invalid artifact rejection;
- receipt identity, hashes, signatures, and ledger outcomes;
- no domain-specific presentation import enters core or policy code.

### E2E matrix

| Domain | Safe | Warn | Block | Unsupported | Simulation/impact |
| --- | --- | --- | --- | --- | --- |
| Network | required | required | required | required | sandbox |
| Terraform | required | required | required | required | external diff |
| Kubernetes | required | required | required | required | sandbox |

The existing network safe and blocked paths remain release gates throughout
the migration.

### Full quality gate

```bash
npm run lint
npm run typecheck
npm run build:packages
npm run build:cli
npm test
npm run build
npm run test:e2e
```

The final Ultragoal story additionally requires the mandated changed-file
cleanup, post-cleanup verification, architecture-invariant audit, and
independent code-reviewer plus architect approval.

## Completion Criteria

The vNext rewrite is complete only when:

1. Network, Terraform, and Kubernetes run in the same workbench without
   domain conditionals in generic shell components.
2. A documented template and contract test show how a fourth domain is added.
3. Risk, findings, legal transitions, receipts, hashes, provenance, and
   simulation semantics retain parity with deterministic code.
4. Public replay and self-hosted modes state their different authority and
   persistence honestly.
5. The UI has no infrastructure execution or credential path.
6. Accessibility, responsive, performance, security, visual, unit,
   integration, and E2E gates pass.
7. The legacy network-only UI and compatibility route are removed only after
   parity is proven.

## Owner Review Gate

This document authorizes planning and issue creation, not implementation.
Implementation begins only after the owner reviews this specification and
approves the product architecture, migration sequence, and scope.
