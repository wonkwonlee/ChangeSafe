# Future Domain Template

Use this template to prove a new infrastructure domain can join the ChangeSafe
workbench without weakening deterministic authority or adding domain branches
to the generic shell. It is an integration checklist, not a production IAM
specification.

## Non-negotiable boundary

The trust model remains:

> AI diagnoses and proposes. Deterministic code validates. A human decides.
> ChangeSafe never executes changes against infrastructure.

A new domain may parse read-only artifacts, evaluate deterministic policies,
simulate changes against deep clones when its shape supports that, and render
validated evidence. It must not add an infrastructure execution client,
domain-specific logic to core policies, or approval logic to presentation
components.

## 1. Implement the pure domain

Create a package that implements `DomainAdapter` from `@changesafe/core`.
`packages/core/tests/standalone-domain.test.ts` is the minimal reference.

The adapter owns:

- validated state extraction;
- transactional declarative operations;
- blast-radius units and known evidence identifiers;
- untrusted text extraction;
- domain policies and any declared universal-policy replacements;
- a version that changes whenever deterministic policy behavior changes.

The package must not import React, the app, or `@changesafe/ai`. It must not
contact infrastructure.

## 2. Choose one honest runtime shape

Register the domain through one of the constructors in
`features/domains/runtime.ts`:

- `defineSimulatedRuntime` for declarative state that can be mutated only on a
  deep clone and safely rolled back;
- `defineExternalDiffRuntime` when the change is already computed elsewhere
  and ChangeSafe only evaluates the supplied diff.

Supply strict Zod boundary schemas, the adapter, immutable static
capabilities, and explicit limitations. An external-diff runtime must not
claim sandbox simulation. A simulated-state runtime must provide its
clone-only simulator.

The runtime derives its ordered policy catalog with core `policyOrder(adapter)`
and exposes the resolved baseline pack, explicit skips, replacements, version,
and limitations. Presentation code does not compute these values.

## 3. Register presentation metadata

Create metadata with `defineDomainPresentation` from
`features/domains/presentation.ts`. The `domainId`, contract version, shape,
and capabilities must exactly match the loaded runtime.

Add one lazy entry to `DOMAIN_REGISTRY` in `features/domains/registry.ts`:

1. keep metadata at module scope so the shell can list the domain without
   importing its package;
2. import the domain package only inside `load()`;
3. return the validated runtime and presentation definitions together.

Do not add direct domain-package imports to generic components. Registry
resolution remains the only app-level loading boundary.

## 4. Supply sources and provenance

Every example, uploaded artifact, or collector result must identify its source,
analysis mode, and provenance through the review contract. Authored fixtures
remain labeled `authored-synthetic`; replay is never presented as live model
analysis.

Collectors are read-only ingestion surfaces. Unsupported sources and unknown
future domains fail closed with an explicit contract error.

## 5. Add the route and edit every sibling shell's navigation

Registry registration alone does not make a domain reachable. Cross-domain
navigation is currently hardcoded in each workbench shell rather than derived
from `DOMAIN_REGISTRY`, so onboarding a domain costs one new route plus one
edit per existing sibling:

1. add `app/workbench/<domainId>/page.tsx`, modeled on
   `app/workbench/terraform/page.tsx` (the Network domain owns `app/page.tsx`);
2. add the new link to the `Runtime navigation` block of **every** existing
   shell — `components/ReviewWorkbenchShell.tsx`,
   `components/TerraformWorkbenchShell.tsx`,
   `components/KubernetesWorkbenchShell.tsx`, and
   `components/SelfHostedReviewWorkbench.tsx` — and add the sibling links to
   the new shell;
3. extend the public client-bundle contract in
   `scripts/verify-public-client-bundles.mjs`: a `PUBLIC_ROUTE_ENTRY_PATHS`
   entry for the source scan, and a `PUBLIC_WORKBENCH_ROUTES` entry carrying
   the emitted `htmlPath` and the foreign policy markers the route must not
   contain.

This is an accepted, deliberately visible cost: navigation is presentation,
not authority, and the deterministic gate never branches on it. Record it
here rather than in a shell so the checklist matches the code.

## 6. Reuse the generic coverage fallback

Render `components/DomainCoverageCatalog.tsx` with the registry metadata,
loaded runtime catalog, current source provenance, and policy identifiers
actually returned by the current evaluation.

The generic renderer deliberately distinguishes:

- registered metadata from a loaded runtime;
- loaded policies from policies evaluated in the current review;
- supported simulation from an unavailable or not-run simulation;
- default policy-pack values from explicit policy skips and replacements.

Do not mark a policy evaluated merely because it exists in the ordered catalog.

## 7. Required proof

Before production registration, add:

- schema accept/reject and policy PASS/WARN/BLOCK tests in the domain package;
- registry agreement and lazy-import tests;
- a generic fallback render test modeled on
  `tests/unit/domain-coverage-catalog.test.ts`;
- safe and adversarial fixtures with honest provenance;
- domain-specific browser coverage for supported and unsupported actions;
- core receipt/hash parity where the domain produces decisions.

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
PORT=3100 npm run test:e2e
```

The test-only `future-example` registration proves the fourth-domain path
without widening the production registry. Production IAM remains unsupported
until it receives its own domain specification, threat review, fixtures, and
release gates.
