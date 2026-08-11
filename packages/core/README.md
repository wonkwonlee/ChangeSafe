# @changesafe/core

The deterministic airlock engine, with no knowledge of any particular
infrastructure domain.

An AI (or any other producer) supplies a typed **change proposal**. Pure
policies validate it, a human decides, and every outcome — approved,
rejected, or blocked — becomes a hashed **receipt**. Core never executes
anything and never calls a model.

> Status: published on npm as `@changesafe/core@0.5.0`. The API remains
> pre-1.0 and may change between minor releases; pin a version in production
> integrations and see `docs/OSS_ROADMAP.md` for the roadmap.

## The shape of a gate

```ts
import {
  evaluatePolicies,
  initialState,
  transition,
  createReceipt,
} from "@changesafe/core";
import { networkDomain } from "@changesafe/domain-network";

const { findings, riskLevel } = evaluatePolicies(
  networkDomain,
  bundle,
  proposal,
);

let state = initialState("scenario-a", bundle);
state = transition(state, { type: "START_ANALYSIS", mode: "replay" });
state = transition(state, {
  type: "PROPOSAL_RECEIVED",
  proposal,
  mode: "replay",
  provenance: "authored_synthetic",
});
state = transition(state, {
  type: "VALIDATION_COMPLETED",
  findings,
  riskLevel,
});
state = transition(state, { type: "CLASSIFY" });
// -> "BLOCKED" or "APPROVAL_REQUIRED"; only a human dispatches APPROVE/REJECT
```

## What core owns

| Area               | Exports                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Proposal contract  | `ChangeProposalSchema`, `ChangeOperationSchema`, `makeProposalSchemas`                                |
| Findings and risk  | `PolicyFindingSchema`, `deriveRiskLevel`, `hasBlockingFinding`                                        |
| Universal policies | `PATCH_SCHEMA`, `BLAST_RADIUS`, `ROLLBACK_COMPLETE`, `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION` |
| The gate           | `evaluatePolicies`, `policyOrder`                                                                     |
| Workflow           | `initialState`, `transition`, `WorkflowState`                                                         |
| Receipts           | `createReceipt`, `verifyReceiptHash`, `canonicalize`, `hashCanonical`                                 |
| Validation         | `validateProposalEvidence`                                                                            |
| Scenario contracts | `ScenarioExpectationsSchema`                                                                          |

Risk derivation is fixed and domain-independent: any `BLOCK` → `CRITICAL`,
two or more `WARN` → `HIGH`, one `WARN` → `MEDIUM`, otherwise `LOW`. Model
confidence is never an input.

## Implementing a domain

A domain teaches core what a change _is_ in its world. Core's universal
policies then work unchanged.

```ts
import type { DomainAdapter } from "@changesafe/core";

const myDomain: DomainAdapter<MyInput, MyState> = {
  domainId: "my-domain",
  policyVersion: "my-domain-v1",

  stateOf: (input) => input.state,

  // Must be transactional: throw rather than partially mutate.
  applyOperations: (state, operations) => ({ nextState, diff }),

  // What the blast radius is counted in — a device, resource, or module.
  blastRadiusUnit: (operation) => ({ kind: "resource", id }) || null,

  // Free text that came from outside the system, scanned for injected
  // instructions. Safety never depends on this catching anything.
  untrustedTexts: (input) => [{ evidenceId, kind: "note", text }],

  knownEvidenceIds: (input) => new Set([...]),

  policies: [{ id: "MY_POLICY", evaluate: (context) => finding }],
};
```

Two domain shapes are supported: **simulated-state** domains hold a
declarative model and apply operations to a clone (see
`@changesafe/domain-network`), and **external-diff** domains consume a
precomputed diff such as a Terraform plan. See `docs/OSS_ROADMAP.md` §5.

`packages/core/tests/standalone-domain.test.ts` implements a complete toy
domain in one file and drives the whole airlock with it — the shortest path
to understanding the contract.

## Rules a domain must keep

1. **Purity.** No IO, no clock, no randomness, no model calls anywhere in
   `applyOperations` or a policy. The same inputs must always produce the
   same findings.
2. **Transactional application.** A failed operation must leave the caller's
   state untouched; core treats a throw as "this change cannot be proven
   safe" and fails closed.
3. **Fail closed.** When a policy cannot establish safety, `BLOCK`. Never
   downgrade an unprovable case to a warning.
4. **Honest ids.** A policy's declared `id` must equal the `policyId` it
   produces; core throws otherwise, because scenario expectations and
   receipts are matched by id.

## Consuming this package

Install the compiled package with `npm i @changesafe/core`. Repository
development uses workspace resolution; published consumers import the compiled
ESM build under plain Node or a bundler.

## License

MIT — see the repository root.
