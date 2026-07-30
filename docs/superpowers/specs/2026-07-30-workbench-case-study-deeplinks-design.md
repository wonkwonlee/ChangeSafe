# Workbench Case-Study Deep Links

**Date:** 2026-07-30

**Status:** Proposed for owner review

**Branch:** new branch, forked from `wonkwonlee/case-studies-doc` (needs
`docs/CASE_STUDIES.md` and its four scenarios, three of which already exist
on `main`; `scenario-p-injected-pr-context` currently only exists on the
still-open `wonkwonlee/scenario-navigation-and-workbench-2` chain)

**Scope:** URL deep-linking to a scenario in each domain workbench, plus a
small "case study" badge in each domain's scenario picker for the four
scenarios featured in `docs/CASE_STUDIES.md`. No new page/route.

## Decision

A visitor reading `docs/CASE_STUDIES.md` should be able to click through to
the live workbench with the relevant scenario pre-selected, instead of
landing on whatever `EXAMPLES[0]` happens to be and hunting for it
manually. Today there is no URL-based scenario selection anywhere in the
app — selection is pure `useState`, reset on every page load — so this adds
that capability, plus a small visual marker in the picker so a visitor
browsing the workbench directly (not from the doc) can spot which four
scenarios have a written case study.

Deep-linking pre-selects the scenario only; it does not auto-run replay.
The product's own principle is that a human decides — a visitor pressing
"Run replay" themselves is consistent with that, and it's the simpler
implementation.

## Approach

Extract two small, shared pieces rather than merging the three duplicated
workbench shells (`ReviewWorkbenchShell`, `TerraformWorkbenchShell`,
`KubernetesWorkbenchShell`) into one component — that merge is a much
larger, unrelated refactor and out of scope here; the existing per-domain
duplication is a pre-existing pattern this work doesn't need to fix to
succeed.

1. **`useScenarioDeepLink` hook** (new, shared, e.g.
   `components/hooks/useScenarioDeepLink.ts`): reads `?scenario=<id>` via
   Next.js `useSearchParams` on mount and returns the initial id (or
   `null`); also returns a `setScenario(id)` callback that each shell calls
   from its existing `selectExample` so the URL reflects the current
   selection via `router.replace` (no new history entry, so back/forward
   doesn't spam scenario changes) — this makes every scenario link
   copy-able, not just the four featured ones. If the id in
   `?scenario=` doesn't match any example in that domain's `EXAMPLES`
   array, fall back to `EXAMPLES[0]` silently (no error UI) — the existing
   default-selection behavior, just with the new lookup layered on top.
2. **`caseStudy` field on `ReviewExampleDescriptorSchema`**
   (`features/domains/review-contract.ts`): an optional, nullable string
   naming which case study a scenario is (or `null` for the other 21).
   Set per-scenario in `features/domains/network/examples.ts` (for
   `scenario-a-failover`, `scenario-b-route-leak`, `scenario-g-silent-regression`)
   and `features/domains/terraform/examples.ts` (for
   `scenario-p-injected-pr-context`) — domain-specific curation data stays
   in the domain-specific file, matching how `label`/`description` are
   already set there.
3. **`CaseStudyBadge` component** (new, shared, small): renders next to a
   picker item's label when `descriptor.caseStudy` is non-null. Style to
   match the existing `ActionBadge` pattern in
   `components/TerraformWorkbenchShell.tsx:99` (closest existing small-pill
   precedent) rather than inventing a new visual language.
4. **`docs/CASE_STUDIES.md` update**: each case study's evidence section
   gains an actual deep link (`/?scenario=scenario-b-route-leak`,
   `/workbench/terraform?scenario=scenario-p-injected-pr-context`, etc.)
   alongside the existing `expectations.json` file link — both kept, since
   the file link is the actual verifiable evidence and the deep link is
   the "see it live" convenience.

## Open question the implementer must resolve before writing code

`REVIEW_CONTRACT_VERSION` (`features/domains/review-contract.ts:23`) is a
literal (`"2.0.0"`) embedded via `contractVersion: z.literal(REVIEW_CONTRACT_VERSION)`
in several schemas including `ReviewExampleDescriptorSchema`. Before adding
the `caseStudy` field, trace where `contractVersion` mismatches are checked
(likely in the self-hosted transport / server round-trip) and confirm this
addition is display-only metadata that doesn't cross that boundary in a way
that would require a version bump. If it does cross that boundary (e.g. the
self-hosted server independently constructs or validates
`ReviewExampleDescriptor` objects against its own copy of the schema),
bump `REVIEW_CONTRACT_VERSION` and follow whatever version-bump procedure
the codebase already has (check for a changelog, test fixtures pinned to
the old version, etc.) rather than silently leaving them out of sync.

## Out of scope

- Merging the three workbench shells into one component.
- Auto-running replay from a deep link.
- A dedicated `/case-studies` landing page/route.
- Any change to scenario data, `scenarios/index.ts`, or policy/schema/engine
  code.
- The external `changesafe-portfolio` site.
- Kubernetes: none of the four case studies are Kubernetes scenarios, so
  `KubernetesWorkbenchShell` only needs the shared `useScenarioDeepLink`
  hook wired in for consistency (so a kubernetes scenario URL still works
  and matches the other two domains' behavior) — it does not need the
  `CaseStudyBadge` to ever actually render there in this pass, since no
  kubernetes `caseStudy` values are set.

## Testing

- Unit/integration test for `useScenarioDeepLink`: given a `?scenario=`
  query param matching an id in the examples list, returns that id; given
  no param or a non-matching id, returns `null`/falls through to the
  existing default.
- Component or e2e-level check (Playwright, matching the existing
  `tests/e2e` pattern) that visiting each of the four
  `docs/CASE_STUDIES.md` deep links actually pre-selects the right
  scenario in the picker (`aria-pressed="true"` on the matching button).
- Confirm `npm run build` still succeeds (Next.js `useSearchParams` usage
  requires a `Suspense` boundary in some configurations — verify whether
  the existing "use client" shells already satisfy this or need one added).
