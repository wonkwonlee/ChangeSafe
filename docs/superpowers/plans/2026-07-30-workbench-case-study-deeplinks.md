# Workbench Case-Study Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor deep-link from `docs/CASE_STUDIES.md` straight into the live workbench with the right scenario pre-selected (`?scenario=<id>`), and mark the four featured scenarios with a small badge in each domain's picker.

**Architecture:** A shared `useScenarioDeepLink` hook (pure resolver function + a thin React wrapper using `useSearchParams`/`useRouter`) wired into each of the three domain workbench shells individually — the shells stay separate, only the new cross-cutting logic is shared. A new optional `caseStudy` field on `ReviewExampleDescriptorSchema` carries curation data; `network` scenarios get it set directly, and `scenario-p-injected-pr-context` is added as a genuinely new fixture entry in the Terraform-only fixture registry (which is independent of `scenarios/terraform/*` — see Task 2) rather than reusing an existing similar-but-different fixture.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Zod, Vitest (`environment: "node"` — no jsdom/component testing here), Playwright (`tests/e2e/`).

## Global Constraints

- No changes to `scenarios/index.ts`, scenario data, or policy/schema/engine code.
- No merge of the three workbench shells into one component.
- Deep-linking pre-selects only; it never auto-runs replay.
- `REVIEW_CONTRACT_VERSION` (`features/domains/review-contract.ts:23`, currently `"2.0.0"`) does **not** need to change — `caseStudy` is sibling to `session`, never nested inside it, and never crosses the analyze-API boundary (verified: `features/reviews/controller.ts:89` only pulls `source.session` out of a descriptor).
- Every `page.tsx` that ends up with a `useSearchParams`-consuming subtree must wrap it in `<Suspense>` or the Next.js build fails.
- `scenario-p-injected-pr-context`'s canonical content lives at `scenarios/terraform/scenario-p-injected-pr-context/incident.json` — the new fixture entry must read from there via import, not hand-duplicate the JSON.
- The existing `terraform-protected-and-injected` fixture (`features/domains/terraform/fixtures.ts`) is untouched — do not remove, rename, or merge it with the new entry.
- `docs/CASE_STUDIES.md`'s existing prose and `expectations.json` evidence links are untouched except for the new deep-link addition per case.
- After every task: `npm test` must stay green (baseline 1111 passed / 4 skipped), `npm run lint` and `npm run typecheck` clean.

---

### Task 1: Add `caseStudy` field to the review contract and set it for the three Network case-study scenarios

**Files:**
- Modify: `features/domains/review-contract.ts` (`ReviewExampleDescriptorSchema`, around line 176-184)
- Modify: `features/domains/network/examples.ts`

**Interfaces:**
- Produces: `ReviewExampleDescriptor.caseStudy: string | null` — every descriptor across all three domains now carries this field (Zod requires every key on a `strictObject` to be present unless the field itself is `.nullable().default(null)` or similarly defaulted — see Step 1 for the exact approach so Terraform's and Kubernetes' existing `ReviewExampleDescriptorSchema.parse({...})` call sites in `features/domains/terraform/examples.ts` and `features/domains/kubernetes/examples.ts` don't need to be touched in this task).

- [ ] **Step 1: Add the field to the schema with a default, so existing call sites keep compiling**

In `features/domains/review-contract.ts`, find `ReviewExampleDescriptorSchema` (around line 176):

```ts
export const ReviewExampleDescriptorSchema = z
  .strictObject({
    domainId: DomainIdSchema,
    contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    sourceId: IdSchema,
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(1000),
    session: ReviewSessionEnvelopeSchema,
  })
```

Add a `caseStudy` field right after `description`:

```ts
export const ReviewExampleDescriptorSchema = z
  .strictObject({
    domainId: DomainIdSchema,
    contractVersion: z.literal(REVIEW_CONTRACT_VERSION),
    sourceId: IdSchema,
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(1000),
    /** Non-null when this example is one of the featured case studies in
     *  docs/CASE_STUDIES.md; names which one (e.g. "Case 2"), shown as a
     *  small badge in the scenario picker. Null for every other example. */
    caseStudy: z.string().min(1).max(40).nullable().default(null),
    session: ReviewSessionEnvelopeSchema,
  })
```

`.default(null)` means every existing `ReviewExampleDescriptorSchema.parse({...})` call site that doesn't pass `caseStudy` (i.e. every terraform and kubernetes example today, and any network example not touched in Step 2) continues to parse successfully with `caseStudy: null`.

- [ ] **Step 2: Set `caseStudy` for the three Network case-study scenarios**

In `features/domains/network/examples.ts`, find the `descriptor` construction inside `NETWORK_SCENARIOS.map(...)` (around line 33-51):

```ts
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: networkMetadata.domainId,
        contractVersion: networkMetadata.contractVersion,
        sourceId: scenario.scenarioId,
        label: scenario.label,
        description: scenario.shortDescription,
        session: {
          ...
        },
      });
```

Add a `caseStudy` line, computed from `scenario.scenarioId`, right before `session`:

```ts
      const CASE_STUDY_LABELS: Record<string, string> = {
        "scenario-a-failover": "Case 1",
        "scenario-b-route-leak": "Case 2",
        "scenario-g-silent-regression": "Case 4",
      };
      // ... inside the .map callback:
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: networkMetadata.domainId,
        contractVersion: networkMetadata.contractVersion,
        sourceId: scenario.scenarioId,
        label: scenario.label,
        description: scenario.shortDescription,
        caseStudy: CASE_STUDY_LABELS[scenario.scenarioId] ?? null,
        session: {
          ...
        },
      });
```

Define `CASE_STUDY_LABELS` once, above the `NETWORK_REVIEW_EXAMPLES` export (module scope), not inside the `.map` callback.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS, 1111 passed / 4 skipped (schema change is additive/defaulted, no existing test should break; if a scenario-contract test asserts an exact key set on `ReviewExampleDescriptor` and fails, that test needs updating to include `caseStudy` — check its failure output and update it to match, don't loosen the assertion).

- [ ] **Step 4: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add features/domains/review-contract.ts features/domains/network/examples.ts
git commit -m "feat(workbench): add caseStudy field to review example descriptor"
```

---

### Task 2: Add `scenario-p-injected-pr-context` as a new Terraform public-replay fixture

**Files:**
- Modify: `features/domains/terraform/fixtures.ts`
- Modify: `features/domains/terraform/examples.ts`

**Interfaces:**
- Consumes: `caseStudy` field from Task 1.
- Produces: a new entry in `TERRAFORM_PUBLIC_REPLAY_FIXTURES` with `sourceId: "scenario-p-injected-pr-context"`, and a `caseStudy: "Case 3"` value on its corresponding `ReviewExampleDescriptor`.

**Depends on:** Task 1 (the `caseStudy` field must exist before this task sets it).

- [ ] **Step 1: Import `scenario-p`'s incident.json into fixtures.ts**

In `features/domains/terraform/fixtures.ts`, add an import alongside the existing three plan imports at the top of the file:

```ts
import destroysDatabasePlan from "../../../packages/domain-terraform/tests/fixtures/destroys-database.tfplan.json";
import protectedAndInjectedPlan from "../../../packages/domain-terraform/tests/fixtures/protected-and-injected.tfplan.json";
import safeScaleUpPlan from "../../../packages/domain-terraform/tests/fixtures/safe-scale-up.tfplan.json";
import scenarioPIncident from "../../../scenarios/terraform/scenario-p-injected-pr-context/incident.json";
```

- [ ] **Step 2: Split the incident's `context` off from the plan shape**

`scenarioPIncident` has the shape `{ format_version, terraform_version, resource_changes, context }` (verified: `scenarios/terraform/scenario-p-injected-pr-context/incident.json`). The fixture's `plan` field expects only the Terraform-plan-shaped keys (no `context` — `context` is a separate field on `TerraformPublicReplayFixture`). Near the top of the file, after the imports, add:

```ts
const { context: scenarioPContext, ...scenarioPPlan } = scenarioPIncident;
```

- [ ] **Step 3: Add the new fixture entry**

In the `TERRAFORM_PUBLIC_REPLAY_FIXTURES` array (around line 76-121), add a fifth entry. Match the existing `TerraformPublicReplayFixture` interface (`sourceId`, `inputId`, `label`, `description`, `provenance`, `plan`, `context`):

```ts
    Object.freeze({
      sourceId: "scenario-p-injected-pr-context",
      inputId: "scenario-p-injected-pr-context",
      label: "Protected billing database, injected PR text",
      description:
        "The exact CHG-2422 scenario featured in the case studies doc: a cleanup PR destroys a protected billing database while its description urges skipping review.",
      provenance: "authored-red-team",
      plan: scenarioPPlan,
      context: scenarioPContext,
    }),
```

Note: `TerraformPublicReplayFixture["sourceId"]` is currently a closed union type (`"terraform-safe-scale-up" | "terraform-destroys-database" | "terraform-protected-and-injected" | "terraform-large-plan-boundary"`, around line 62-66). Widen it to include the new id:

```ts
export interface TerraformPublicReplayFixture {
  readonly sourceId:
    | "terraform-safe-scale-up"
    | "terraform-destroys-database"
    | "terraform-protected-and-injected"
    | "terraform-large-plan-boundary"
    | "scenario-p-injected-pr-context";
  ...
```

- [ ] **Step 4: Set `caseStudy` on the corresponding descriptor**

In `features/domains/terraform/examples.ts`, find the `descriptor` construction inside `TERRAFORM_PUBLIC_REPLAY_FIXTURES.map(...)` (around line 30-45):

```ts
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: terraformMetadata.domainId,
        contractVersion: terraformMetadata.contractVersion,
        sourceId: fixture.sourceId,
        label: fixture.label,
        description: fixture.description,
        session: {
          ...
        },
      });
```

Add `caseStudy`, computed from `fixture.sourceId`:

```ts
      const descriptor = ReviewExampleDescriptorSchema.parse({
        domainId: terraformMetadata.domainId,
        contractVersion: terraformMetadata.contractVersion,
        sourceId: fixture.sourceId,
        label: fixture.label,
        description: fixture.description,
        caseStudy: fixture.sourceId === "scenario-p-injected-pr-context" ? "Case 3" : null,
        session: {
          ...
        },
      });
```

- [ ] **Step 5: Verify the new fixture evaluates the way `expectations.json` says it should**

Run the app locally (`npm run dev`), open `http://localhost:3000/workbench/terraform`, select "Protected billing database, injected PR text" in the picker, click "Run replay". Confirm the findings match `scenarios/terraform/scenario-p-injected-pr-context/expectations.json` exactly: `DESTRUCTIVE_OP` BLOCK, `PROTECTED_RESOURCE` BLOCK, `REVERSIBILITY` WARN, `UNTRUSTED_INSTRUCTION` WARN, everything else PASS, CRITICAL, not approvable. If any status differs, the plan/context split in Step 2 or 3 is wrong — fix it before proceeding, don't adjust the expected values (the real scenario's `expectations.json` is ground truth, already CI-verified elsewhere).

- [ ] **Step 6: Run tests, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all clean, 1111 passed / 4 skipped (or higher if a new test was added elsewhere — should not decrease).

- [ ] **Step 7: Commit**

```bash
git add features/domains/terraform/fixtures.ts features/domains/terraform/examples.ts
git commit -m "feat(workbench): add scenario-p-injected-pr-context as a terraform public-replay fixture"
```

---

### Task 3: `useScenarioDeepLink` hook, with a unit-testable pure resolver

**Files:**
- Create: `components/hooks/useScenarioDeepLink.ts`
- Create: `components/hooks/useScenarioDeepLink.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is pure new code, independently testable).
- Produces:
  - `resolveInitialScenarioId(searchParams: URLSearchParams | null, availableIds: readonly string[]): string | null` — pure function, exported for the unit test and for the hook to call.
  - `useScenarioDeepLink(availableIds: readonly string[]): { initialScenarioId: string | null; setScenarioInUrl: (id: string) => void }` — the React hook, consumed by each shell in Tasks 4-6.

- [ ] **Step 1: Write the failing unit test for the pure resolver**

Create `components/hooks/useScenarioDeepLink.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveInitialScenarioId } from "./useScenarioDeepLink";

describe("resolveInitialScenarioId", () => {
  it("returns the id when the scenario query param matches an available id", () => {
    const params = new URLSearchParams("scenario=scenario-b-route-leak");
    const result = resolveInitialScenarioId(params, [
      "scenario-a-failover",
      "scenario-b-route-leak",
    ]);
    expect(result).toBe("scenario-b-route-leak");
  });

  it("returns null when there is no scenario query param", () => {
    const params = new URLSearchParams("");
    const result = resolveInitialScenarioId(params, ["scenario-a-failover"]);
    expect(result).toBeNull();
  });

  it("returns null when the scenario query param doesn't match any available id", () => {
    const params = new URLSearchParams("scenario=does-not-exist");
    const result = resolveInitialScenarioId(params, ["scenario-a-failover"]);
    expect(result).toBeNull();
  });

  it("returns null when searchParams itself is null", () => {
    const result = resolveInitialScenarioId(null, ["scenario-a-failover"]);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/hooks/useScenarioDeepLink.test.ts`
Expected: FAIL — `useScenarioDeepLink.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Write `components/hooks/useScenarioDeepLink.ts`**

```ts
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

/**
 * Pure lookup, split out from the hook so it's testable without a React
 * or Next.js runtime. Returns null (not a thrown error) for a missing or
 * unrecognized id — callers fall back to their own default (EXAMPLES[0]).
 */
export function resolveInitialScenarioId(
  searchParams: URLSearchParams | null,
  availableIds: readonly string[],
): string | null {
  const candidate = searchParams?.get("scenario");
  if (!candidate) return null;
  return availableIds.includes(candidate) ? candidate : null;
}

/**
 * Reads `?scenario=<id>` on mount to seed the initial scenario selection,
 * and keeps the URL in sync as the visitor picks a different scenario —
 * every scenario becomes a copy-able link, not just the featured ones.
 *
 * Must be called from a component rendered under a <Suspense> boundary
 * (Next.js requirement for useSearchParams in an otherwise-static page).
 */
export function useScenarioDeepLink(availableIds: readonly string[]): {
  readonly initialScenarioId: string | null;
  readonly setScenarioInUrl: (id: string) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialScenarioId = useMemo(
    () => resolveInitialScenarioId(searchParams, availableIds),
    // Only resolved once per mount's initial params — intentionally not
    // re-derived as the URL changes afterward, since setScenarioInUrl is
    // the only writer once the component is interactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setScenarioInUrl = (id: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("scenario", id);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return { initialScenarioId, setScenarioInUrl };
}
```

Check the repo's actual ESLint config for whether `react-hooks/exhaustive-deps` is an active rule before including the disable comment — if the rule isn't enabled, delete the comment (an unnecessary disable comment for a rule that isn't active is itself a lint-adjacent nit worth avoiding). Search `.eslintrc*` / `eslint.config.*` for `react-hooks`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run components/hooks/useScenarioDeepLink.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Run full tests, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all clean, test count increases by 4 (1111 → 1115 passed, still 4 skipped).

- [ ] **Step 6: Commit**

```bash
git add components/hooks/useScenarioDeepLink.ts components/hooks/useScenarioDeepLink.test.ts
git commit -m "feat(workbench): add useScenarioDeepLink hook with unit-tested resolver"
```

---

### Task 4: `CaseStudyBadge` component

**Files:**
- Create: `components/CaseStudyBadge.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks except styling convention (`ActionBadge` in `components/TerraformWorkbenchShell.tsx:99-102`).
- Produces: `<CaseStudyBadge label={string} />`, consumed by Tasks 5-6.

- [ ] **Step 1: Write the component**

Create `components/CaseStudyBadge.tsx`, matching `ActionBadge`'s pill styling (`components/TerraformWorkbenchShell.tsx:99-102`) but with a distinct tone so it doesn't read as a risk/action indicator:

```tsx
export function CaseStudyBadge({ label }: { readonly label: string }) {
  return (
    <span
      className="eyebrow ml-2 rounded border border-active/50 bg-active/10 px-2 py-1 text-active"
      title={`Featured in docs/CASE_STUDIES.md — ${label}`}
    >
      Case study
    </span>
  );
}
```

- [ ] **Step 2: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both clean (no test to run for a pure presentational component with no logic — covered indirectly by the e2e tests in Task 7).

- [ ] **Step 3: Commit**

```bash
git add components/CaseStudyBadge.tsx
git commit -m "feat(workbench): add CaseStudyBadge component"
```

---

### Task 5: Wire the hook and badge into the Network workbench

**Files:**
- Modify: `components/ReviewWorkbenchShell.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useScenarioDeepLink` (Task 3), `CaseStudyBadge` (Task 4), `caseStudy` field (Task 1).

**Depends on:** Tasks 1, 3, 4.

- [ ] **Step 1: Add the `<Suspense>` boundary in `app/page.tsx`**

```tsx
import type { Metadata } from "next";
import { Suspense } from "react";

import { ReviewWorkbenchShell } from "@/components/ReviewWorkbenchShell";
import { loadDomainCoverageCatalog } from "@/features/domains/registry";

export const metadata: Metadata = {
  title: "ChangeSafe Workbench — Public Replay",
  description:
    "Run schema-validated bundled Network replays in an ephemeral workbench. No decisions are recorded, and ChangeSafe never executes infrastructure changes.",
};

export default async function Page() {
  const coverageCatalog = await loadDomainCoverageCatalog("network");
  return (
    <Suspense fallback={null}>
      <ReviewWorkbenchShell coverageCatalog={coverageCatalog} />
    </Suspense>
  );
}
```

- [ ] **Step 2: Import the hook and badge in `ReviewWorkbenchShell.tsx`**

Add to the import block (near the top, alongside the other `@/components`/`@/features` imports):

```ts
import { CaseStudyBadge } from "@/components/CaseStudyBadge";
import { useScenarioDeepLink } from "@/components/hooks/useScenarioDeepLink";
```

- [ ] **Step 3: Use the hook to seed initial selection**

Find the component body (around line 168):

```ts
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
```

Replace with:

```ts
  const { initialScenarioId, setScenarioInUrl } = useScenarioDeepLink(
    NETWORK_REVIEW_EXAMPLES.map((example) => example.sourceId),
  );
  const [selectedSourceId, setSelectedSourceId] = useState(
    initialScenarioId ?? INITIAL_EXAMPLE.sourceId,
  );
```

- [ ] **Step 4: Trigger the deep-linked scenario's rebind on mount**

Initializing `useState` with `initialScenarioId` only sets which id is "selected" — it does not call `controller.rebind(...)` the way `selectExample` does, so the workflow/proposal data underneath wouldn't actually match the deep-linked scenario. Add a `useEffect` right after the existing `selectExample` callback definition (around line 187, after the `useCallback` block) that calls `selectExample` once if a deep link was present:

```ts
  useEffect(() => {
    if (initialScenarioId) {
      selectExample(initialScenarioId);
    }
    // Intentionally runs once on mount only — selectExample itself updates
    // selectedSourceId and the URL, and re-running this on every
    // selectExample identity change would fight the user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Verify (same as Task 3 Step 3) whether the `react-hooks/exhaustive-deps` disable comment is needed given the actual ESLint config; drop it if the rule isn't active.

- [ ] **Step 5: Sync the URL when the visitor picks a scenario manually**

In the existing `selectExample` callback (around line 175-186), add a call to `setScenarioInUrl` after `setSelectedSourceId`:

```ts
  const selectExample = useCallback(
    (sourceId: string) => {
      const nextScenario = scenarioFor(sourceId);
      const nextExample = exampleFor(sourceId);
      controller.rebind({
        sourceId: nextScenario.scenarioId,
        input: nextScenario.input as IncidentBundle,
        expectedInputId: nextScenario.inputId,
        session: nextExample.session,
      });
      setSelectedSourceId(sourceId);
      setScenarioInUrl(sourceId);
    },
    [controller, setScenarioInUrl],
  );
```

- [ ] **Step 6: Render the badge in the picker**

Find the picker item render (around line 296-303):

```tsx
                >
                  <span className="block font-medium text-ink">{example.label}</span>
                  <span className="mt-1 block text-xs">{example.description}</span>
                </button>
```

Add the badge next to the label when `example.caseStudy` is set:

```tsx
                >
                  <span className="block font-medium text-ink">
                    {example.label}
                    {example.caseStudy ? <CaseStudyBadge label={example.caseStudy} /> : null}
                  </span>
                  <span className="mt-1 block text-xs">{example.description}</span>
                </button>
```

- [ ] **Step 7: Manual verification**

Run `npm run dev`, visit `http://localhost:3000/?scenario=scenario-b-route-leak`. Confirm: the "Case 2" badge is visible on the matching picker item, that item shows `aria-pressed="true"`, and the right-hand panels show scenario-b's data (topology, evidence) — but replay has NOT run yet ("Run replay" button still present, no findings shown). Click "Run replay" and confirm CRITICAL/BLOCKED findings appear.

Also visit `http://localhost:3000/` with no query param and confirm behavior is unchanged from before this task (defaults to `scenario-a-failover`).

- [ ] **Step 8: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all clean. The build step specifically confirms the `Suspense` boundary satisfies Next.js's `useSearchParams` requirement — if the build errors about a missing Suspense boundary, the boundary in Step 1 is misplaced (must wrap the component that calls `useSearchParams`, not just be present somewhere on the page).

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx components/ReviewWorkbenchShell.tsx
git commit -m "feat(workbench): wire scenario deep links and case-study badges into the Network workbench"
```

---

### Task 6: Wire the hook and badge into the Terraform workbench

**Files:**
- Modify: `components/TerraformWorkbenchShell.tsx`
- Modify: `app/workbench/terraform/page.tsx`

**Interfaces:**
- Consumes: `useScenarioDeepLink` (Task 3), `CaseStudyBadge` (Task 4), `caseStudy` field (Task 2).

**Depends on:** Tasks 2, 3, 4, and the pattern established in Task 5 (mirror it here — same five sub-steps: Suspense boundary, hook import, seed initial state, mount effect, sync-on-select, render badge).

- [ ] **Step 1: Add `<Suspense>` in `app/workbench/terraform/page.tsx`** — same shape as Task 5 Step 1, wrapping `<TerraformWorkbenchShell coverageCatalog={coverageCatalog} />`.

- [ ] **Step 2: Import the hook and badge in `TerraformWorkbenchShell.tsx`** — same imports as Task 5 Step 2.

- [ ] **Step 3: Seed initial selection**

Find (around line 184):

```ts
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
```

Replace with the same pattern as Task 5 Step 3, using `TERRAFORM_REVIEW_EXAMPLES.map((example) => example.sourceId)` as the available-ids list.

- [ ] **Step 4: Mount effect to trigger the deep-linked scenario's rebind** — same pattern as Task 5 Step 4, calling this shell's `selectExample`.

- [ ] **Step 5: Sync URL on manual selection**

Find the `selectExample` callback (around line 203-215):

```ts
  const selectExample = useCallback((sourceId: string) => {
    const nextFixture = fixtureFor(sourceId);
    const nextExample = exampleFor(sourceId);
    controller.rebind({
      sourceId: nextFixture.sourceId,
      input: inputFor(nextFixture),
      expectedInputId: nextFixture.inputId,
      session: nextExample.session,
    });
    setSelectedSourceId(sourceId);
    setChangeQuery("");
    setChangePageIndex(0);
  }, [controller]);
```

Add `setScenarioInUrl(sourceId);` alongside `setSelectedSourceId(sourceId);`, and add `setScenarioInUrl` to the dependency array.

- [ ] **Step 6: Render the badge**

Find the picker item (around line 325):

```tsx
              <li key={candidate.sourceId}><button aria-pressed={candidate.sourceId === selectedSourceId} className="w-full rounded border border-edge px-3 py-2 text-left text-sm text-ink-dim hover:border-active focus:outline-none focus:ring-2 focus:ring-active disabled:cursor-wait" disabled={workflow.phase === "ANALYZING"} onClick={() => selectExample(candidate.sourceId)} type="button"><span className="block font-medium text-ink">{candidate.label}</span><span className="mt-1 block text-xs">{candidate.description}</span></button></li>
```

Change the label span to:

```tsx
<span className="block font-medium text-ink">{candidate.label}{candidate.caseStudy ? <CaseStudyBadge label={candidate.caseStudy} /> : null}</span>
```

- [ ] **Step 7: Manual verification**

Run `npm run dev`, visit `http://localhost:3000/workbench/terraform?scenario=scenario-p-injected-pr-context`. Confirm the "Case 3" badge shows on the matching item, `aria-pressed="true"`, replay not yet run. Click "Run replay", confirm the findings match `scenarios/terraform/scenario-p-injected-pr-context/expectations.json` (same check as Task 2 Step 5, now via the deep link path specifically).

- [ ] **Step 8: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add app/workbench/terraform/page.tsx components/TerraformWorkbenchShell.tsx
git commit -m "feat(workbench): wire scenario deep links and case-study badges into the Terraform workbench"
```

---

### Task 7: Wire the hook into the Kubernetes workbench (no badge needed)

**Files:**
- Modify: `components/KubernetesWorkbenchShell.tsx`
- Modify: `app/workbench/kubernetes/page.tsx`

**Interfaces:**
- Consumes: `useScenarioDeepLink` (Task 3) only — no `caseStudy` values are set on any Kubernetes example in this plan, so `CaseStudyBadge` is imported but will simply never render (`candidate.caseStudy` is always `null` there), which is fine and matches the design's explicit scope note.

**Depends on:** Task 3, and the pattern from Tasks 5-6.

- [ ] **Step 1: Add `<Suspense>` in `app/workbench/kubernetes/page.tsx`** — same shape as Task 5 Step 1, wrapping `<KubernetesWorkbenchShell coverageCatalog={coverageCatalog} />`.

- [ ] **Step 2: Import the hook (and badge, for consistency with the other two shells) in `KubernetesWorkbenchShell.tsx`.**

- [ ] **Step 3: Seed initial selection**

Find (around line 337):

```ts
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
```

Same pattern as Tasks 5-6, using `KUBERNETES_REVIEW_EXAMPLES.map((example) => example.sourceId)`.

- [ ] **Step 4: Mount effect to trigger the deep-linked scenario's rebind** — same pattern, calling this shell's `selectExample`.

- [ ] **Step 5: Sync URL on manual selection**

Find the `selectExample` callback (around line 381) and add `setScenarioInUrl(sourceId);` the same way as Tasks 5-6.

- [ ] **Step 6: Render the badge (inert here, but consistent)**

Find the picker item (around line 462, the long single-line block) and apply the same label-span change as Task 6 Step 6, using `candidate.caseStudy`.

- [ ] **Step 7: Manual verification**

Visit `http://localhost:3000/workbench/kubernetes?scenario=scenario-l-replica-zero` (or any real kubernetes scenario id) and confirm it pre-selects correctly (no badge expected, since no kubernetes `caseStudy` values exist). Visit with no query param and confirm unchanged default behavior.

- [ ] **Step 8: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add app/workbench/kubernetes/page.tsx components/KubernetesWorkbenchShell.tsx
git commit -m "feat(workbench): wire scenario deep links into the Kubernetes workbench for consistency"
```

---

### Task 8: Playwright e2e coverage for the four case-study deep links

**Files:**
- Create: `tests/e2e/case-study-deeplinks.spec.ts`

**Interfaces:**
- Consumes: the deep-link behavior wired in Tasks 5-7.

**Depends on:** Tasks 5, 6 (this task only tests Network and Terraform, since those are the two domains with actual case-study scenarios).

- [ ] **Step 1: Write the test file**

Match the existing style in `tests/e2e/terraform-workbench.spec.ts` / `tests/e2e/workbench.spec.ts` (`test(...)` blocks, `page.goto`, `expect(page.getByRole(...))`):

```ts
import { expect, test } from "@playwright/test";

test("Case 1 deep link pre-selects scenario-a-failover without running replay", async ({ page }) => {
  await page.goto("/?scenario=scenario-a-failover");
  await expect(
    page.getByRole("button", { name: /Degraded primary uplink/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Run replay" })).toBeVisible();
  await expect(page.getByText("No evaluated proposal is available yet.")).toBeVisible();
});

test("Case 2 deep link pre-selects scenario-b-route-leak and shows the case-study badge", async ({ page }) => {
  await page.goto("/?scenario=scenario-b-route-leak");
  const item = page.getByRole("button", { name: /Suspected route leak/ });
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item.getByText("Case study")).toBeVisible();
});

test("Case 3 deep link pre-selects scenario-p-injected-pr-context on the Terraform workbench", async ({ page }) => {
  await page.goto("/workbench/terraform?scenario=scenario-p-injected-pr-context");
  const item = page.getByRole("button", { name: /Protected billing database/ });
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(item.getByText("Case study")).toBeVisible();
});

test("Case 4 deep link pre-selects scenario-g-silent-regression", async ({ page }) => {
  await page.goto("/?scenario=scenario-g-silent-regression");
  await expect(
    page.getByRole("button", { name: /Redundant standby transit path/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("an unrecognized scenario id falls back to the default example", async ({ page }) => {
  await page.goto("/?scenario=does-not-exist");
  await expect(
    page.getByRole("button", { name: /Degraded primary uplink/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Case 3 replay run produces the expected CRITICAL/BLOCKED findings", async ({ page }) => {
  await page.goto("/workbench/terraform?scenario=scenario-p-injected-pr-context");
  await page.getByRole("button", { name: "Run replay" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "BLOCKED" })).toBeVisible();
});
```

Verify each `getByRole("button", { name: /.../ })` selector's accessible name actually matches what the picker button renders (the button's accessible name includes both the label and description text spans, per the existing picker markup — adjust the regex to a substring that's unambiguous if a raw title match doesn't work; check against `tests/e2e/workbench.spec.ts`'s existing scenario-selection assertions, if any, for the established selector idiom in this codebase before inventing a new one).

- [ ] **Step 2: Run the new e2e tests**

Run: `npx playwright test tests/e2e/case-study-deeplinks.spec.ts`
Expected: all 6 tests PASS. If a selector doesn't match, inspect the actual rendered markup (`npx playwright test --debug` or check `tests/e2e/*.spec.ts-snapshots` conventions already in the repo) and fix the selector — don't loosen the assertion to something that would pass regardless of correctness.

- [ ] **Step 3: Run the full e2e suite to confirm no regression**

Run: `npm run test:e2e`
Expected: all existing + new tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/case-study-deeplinks.spec.ts
git commit -m "test(e2e): cover the four case-study deep links and fallback behavior"
```

---

### Task 9: Update `docs/CASE_STUDIES.md` with live deep links

**Files:**
- Modify: `docs/CASE_STUDIES.md`

**Interfaces:**
- Consumes: the deep-link URLs now functional per Tasks 5-6.

**Depends on:** Tasks 5, 6 (the links must actually work before the doc claims they do).

- [ ] **Step 1: Add a deep link under each case's existing evidence line**

Case 1 (after the existing `Evidence:` line for `scenario-a-failover`):

```markdown
Evidence: [`scenarios/network/scenario-a-failover/expectations.json`](../scenarios/network/scenario-a-failover/expectations.json)

Try it live: `/?scenario=scenario-a-failover`
```

Case 2 (`scenario-b-route-leak`):

```markdown
Evidence: [`scenarios/network/scenario-b-route-leak/expectations.json`](../scenarios/network/scenario-b-route-leak/expectations.json)

Try it live: `/?scenario=scenario-b-route-leak`
```

Case 3 (`scenario-p-injected-pr-context`):

```markdown
Evidence: [`scenarios/terraform/scenario-p-injected-pr-context/expectations.json`](../scenarios/terraform/scenario-p-injected-pr-context/expectations.json)

Try it live: `/workbench/terraform?scenario=scenario-p-injected-pr-context`
```

Case 4 (`scenario-g-silent-regression`):

```markdown
Evidence: [`scenarios/network/scenario-g-silent-regression/expectations.json`](../scenarios/network/scenario-g-silent-regression/expectations.json)

Try it live: `/?scenario=scenario-g-silent-regression`
```

Use relative paths (`/?scenario=...`), not an absolute `http://localhost:3000` or a hosted-deployment domain — the existing "Try it yourself" section already tells the reader to run `npm run dev` and open `http://localhost:3000` first, so a path-only link composes correctly with that instruction (and stays correct if the hosted deployment domain ever changes).

- [ ] **Step 2: Update the closing "Try it yourself" section**

The existing text says "Pick any scenario by its id in that workbench's scenario picker and run the replay." Add one sentence noting the new deep-link capability, e.g. append: "Each case above also links directly to its pre-selected scenario, if you'd rather skip the picker."

- [ ] **Step 3: Fact-check pass**

Re-read all four new "Try it live" links against the actual `sourceId` values used in each domain's picker (network: the scenario's own `scenarioId`, confirmed direct in `NETWORK_SCENARIOS`; terraform Case 3: `"scenario-p-injected-pr-context"`, confirmed set as the new fixture's `sourceId` in Task 2). A typo here silently breaks the deep link with no visible error (falls back to the default scenario) — this is the single easiest mistake to make and the hardest for a reader to notice, so double-check character-for-character against Task 2's Step 3 fixture definition and `scenarios/network.ts`'s scenario ids.

- [ ] **Step 4: Manual verification**

Click (or curl, or manually visit) all four "Try it live" links from a running `npm run dev` instance and confirm each pre-selects the right scenario, matching Task 5/6's manual verification steps.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: clean (markdown-adjacent, should be a no-op, confirms nothing else was touched).

- [ ] **Step 6: Commit**

```bash
git add docs/CASE_STUDIES.md
git commit -m "docs: add live deep links to the four case studies"
```

---

## Self-Review Notes (already applied above)

- Spec coverage: every element of the design (`useScenarioDeepLink`, `caseStudy` field, `CaseStudyBadge`, the terraform-fixture-registry discovery and its resolution, the `docs/CASE_STUDIES.md` update, Suspense requirement, contract-version non-requirement) has a task.
- No placeholder steps: every code block is complete, copy-pasteable, and grounded in the actual current file contents (verified via direct reads during planning, not guessed).
- Type/interface consistency: `useScenarioDeepLink`'s return shape (`initialScenarioId`, `setScenarioInUrl`) is used identically across Tasks 5, 6, and 7. `CaseStudyBadge`'s `label` prop matches the `caseStudy` field's type (`string`, since the badge is only rendered when `caseStudy` is truthy) throughout.
- Task 2 is flagged as an unusually careful task (Step 5's exact-findings-match manual check) precisely because it's the one place this plan adds new *content*, not just new *wiring* — everything else is additive UI/hook code with no new data-correctness risk.
