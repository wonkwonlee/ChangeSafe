---
target: "http://localhost:3000/workbench/terraform (pre-deploy, round 2)"
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-08T06-10-51Z
slug: change-safe-vercel-app-workbench-terraform
---
Method: dual-agent (A: recrit2-tf-A · B: recrit2-tf-B) — second re-critique, checking the cross-page fix round

> **Note on what was tested**: local dev server (`http://localhost:3000/workbench/terraform`), not yet deployed. Persisted under the production URL's slug for trend continuity.

## Change Ledger

**Fixed and independently verified twice (numbers match to the decimal):**
- **Badge contrast** — BLOCK 5.65:1, WARN 7.50:1, PASS 7.45:1 on a real rendered BLOCK scenario, matching the home-page numbers exactly.
- **Diff screen-reader labels** — confirmed in the accessibility tree by both agents (not just the DOM): `.sr-only` computes `clip-path:inset(50%)`, genuinely exposed to assistive tech rather than `display:none`; a screen reader now hears "removed: {" instead of an unlabeled glyph. B independently confirmed via `ariaSnapshot()`. This is a real semantic fix, not a cosmetic one.
- **Sticky rail at true 1100px** — confirmed functionally by both (rail's `top` offset moves from 225px to 16px and pins during a scroll test), matching the home-page verification.

**Confirmed still broken (unchanged, out of scope this round):** untrusted-context quarantine, leaf-summary trapped in a collapsed disclosure, findings not linked to the resources they name — and B found this is now made *worse* by a new discovery: the same resource is spelled three different ways across findings in one list (`resource:module.data.aws_db_instance.primary` / `/resources/module-data-aws-db-instance-primary` / `resource:module-data-aws-db-instance-primary`), meaning linking can't even be built until the identifiers are normalized at the presentation boundary.

**New defects, both introduced by this round's fixes:**
- **[P1] Real mobile horizontal overflow (196px), missed by the standard overflow check** — B traced actual page content moving sideways (h1 left offset goes from 33px to −164px) to a `min-w-72` table cell containing the diff `<details>`. Critically, the table *is* correctly wrapped in an `overflow-x-auto` container, so the usual "is this clipped by a scroll ancestor" heuristic reports zero offenders and would call the page clean — only a DOM bisect plus watching content physically move caught it. This appears to be the DiffBlock work interacting with Terraform's table-cell layout differently than Kubernetes' card layout, where the equivalent fix was applied.
- **[P2] The sticky rail clips its own safety statement on short viewports** — both agents independently found this: at 1100×550 (A) and 1100×700 (B), the rail (669–714px tall) exceeds the viewport with no `max-height`/`overflow-y`, so "Terraform execution — Not performed or observed" is off-screen for nearly the entire scroll range. Lowering the breakpoint from `xl` to `lg` moved this problem into a common laptop window-height range it didn't reach before.
- **[P2] The badge system is now visually split** — `StatusBadge` (policy verdicts) is solid-fill; `ActionBadge` (plan actions: create/update/replace/delete) is still the old tinted-outline style, both same shape/size within 600px of each other on the same page, so form no longer reliably signals category.

## Design Health Score: **26/40** (unchanged — Acceptable)

The score holding flat is the honest result: this round's three targeted P2 fixes are all confirmed genuinely fixed (two of them semantically, not just visually), but the three P1 information-architecture issues that actually gate this page's score were untouched, and the round's changes introduced a new P1 (mobile overflow) that offsets the P2 gains.

## Design Specificity Verdict

**LLM assessment**: Still strongly product-specific. The right rail's capability disclosures ("Simulation → unavailable and why," "Terraform execution → never performed or observed") and the policy-skip rationale explaining `ROLLBACK_COMPLETE` is replaced by `REVERSIBILITY` because "a Terraform plan carries no inverse operations to verify" are original arguments no template produces. The generic middle of the page — a stock admin table and an untrusted-context card styled identically to trusted evidence — is unchanged from last round.

**Browser evidence**: contrast validated against 8 controls including `oklch`/`color-mix` cases before any app measurement. The diff line colors (removed 5.00:1, added 6.30:1) pass but the removed variant has almost no margin above the 4.5:1 line — worth flagging for any future palette adjustment. The "Replay evaluated" button trap reproduced exactly as documented on the home page: a naive computed-style read reports 6.96:1 (passing) while the correct opacity-composited figure is 2.69–2.70:1 (failing), confirmed against actual rendered pixels, not just predicted math — B explicitly warns that any contrast tool not accounting for group `opacity` will silently misreport this element.

## Overall Impression

Two of three targeted fixes are genuinely, semantically correct — the diff's screen-reader labels in particular were verified in the accessibility tree, not just visually, which is the right bar. But the round's net effect on the page is close to a wash: real accessibility gains were offset by a newly-introduced mobile overflow bug that the standard scroll-container check can't catch, and a sticky-rail side effect that hides the page's most important safety sentence on ordinary laptop window heights. The three P1s that actually determine how a reviewer uses this page — connecting a verdict to its evidence, surfacing the one-sentence summary, and quarantining untrusted content — remain exactly where they were.

## What's Working

1. **The diff's screen-reader fix is a real semantic fix, independently confirmed in the accessibility tree by both agents** — `.sr-only` is genuinely exposed (clip-path, not display:none), and a screen reader now hears "removed:" / "added:" instead of an unlabeled glyph.
2. **Badge contrast is fixed the right way and holds under the hardest case** — measured on an actual rendered BLOCK inside its tinted card, where the original bug lived, not just in isolation.
3. **Sticky positioning is functionally proven, not just declared** — both agents ran real scroll tests rather than trusting computed styles alone.

## Priority Issues

**[P1] New: real mobile horizontal overflow (196px), invisible to the standard overflow check**
Why it matters: page content physically shifts sideways at a verified true 390px viewport — confirmed by watching the `<h1>` and `<header>` left offsets move, not just by a scrollWidth/clientWidth comparison, which a naive check would pass here since the offending element sits inside a correctly-configured `overflow-x-auto` wrapper. Traced to a `min-w-72` table cell containing the new diff `<details>`.
Fix: add `min-w-0` to the table cell and its content chain (the same fix already applied to Kubernetes' equivalent diff container), and add a Playwright assertion comparing `document.documentElement.scrollWidth` (not just the body's) against `clientWidth` at 390px so this class of bug can't hide behind a correctly-scrolling child container again.
Suggested command: `/impeccable adapt`

**[P1] Carried over: the injected prompt still renders with no quarantine treatment**
Unchanged from last round — the adversarial text is styled identically to trusted evidence, 1,865px from the finding that neutralizes it, with no local signal it's inert.
Suggested command: `/impeccable harden`

**[P1] Carried over: findings still don't reach the resources they name — and the same resource is now confirmed spelled three different ways**
1,961px gap, zero links, unchanged. New and worse: `DESTRUCTIVE_OP`, `PATCH_SCHEMA`, and `BLAST_RADIUS` each reference the same resource with a different identifier format (dotted vs. dashed, prefixed vs. bare path) — linking can't be built at all until these are normalized at the presentation boundary.
Suggested command: `/impeccable clarify`

**[P1] Carried over: the one sentence a reviewer needs is still behind a closed disclosure**
Confirmed on a safe 3-resource plan: all rows render `open: false`, hiding an eleven-word summary ("min_size: 2 → 4 · max_size: 6 → 12 · desired_capacity: 2 → 4") behind a label that only repeats the address already visible in the adjacent column.
Suggested command: `/impeccable distill`

**[P2] New: the sticky rail clips the page's own safety statement on ordinary laptop window heights**
Why it matters: independently found by both agents at slightly different short viewports (1100×550 and 1100×700) — the rail (669–714px tall) has no `max-height`/`overflow-y`, so "Terraform execution — Not performed or observed" is off-screen for nearly the entire scroll range once the rail engages, a range that only became reachable because this round lowered the sticky breakpoint from `xl` to `lg`.
Fix: `lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto` on the rail, or collapse the four static capability sections into one block so the rail fits without needing to scroll internally.
Suggested command: `/impeccable layout`

**[P2] New: the badge system is now visually split between two components**
Why it matters: `StatusBadge` (policy verdicts) moved to solid fill; `ActionBadge` (plan actions) stayed tinted-outline, both same pill shape within 600px on the same page, so a reviewer now has to learn that solid means one thing and outlined means another with nothing communicating the distinction.
Fix: pick one form for both, or deliberately differentiate ActionBadge's shape (square corners, no border) so the difference reads as intentional categorization rather than inconsistency.
Suggested command: `/impeccable polish`

**[P2] Carried over: "Replay evaluated" still measures 2.69–2.70:1, confirmed against actual rendered pixels**
Both this round's assessments independently derived the same figure two different ways (opacity-composited math and ground-truth pixel read-back), both flagging that a naive contrast tool would report this as passing (6.96:1) and be wrong — worth noting as a durable trap for any future automated check on this codebase specifically, since it relies on group `opacity` rather than a token swap to express "disabled."
Suggested command: `/impeccable polish`

## Cognitive Load

6 of 8 checklist items fail (high load, critical band) — unchanged in severity from the underlying causes (12 simultaneous focusable controls, 7 ungrouped findings, ~2,000px working-memory bridges now in three id spellings instead of one).

## Persona Red Flags

**Sam (Accessibility-Dependent)**: materially better than last round — diff lines announce correctly, badges clear AA against real BLOCK content, focus rings are consistent. Remaining: the "Replay evaluated" confirmation is 2.69:1, effectively invisible at low vision; the `<pre aria-label="…diff">` has no `role`, so the label may not be exposed by all AT.

**Alex (Impatient Power User)**: still three disclosure clicks to read a 3-resource plan; no expand-all; no keyboard path from a finding to its resource.

**Riley (Stress Tester)**: correctly identifies that the red-team scenario's gate logic works but its UI doesn't show it — the injection payload styled identically to trusted evidence — and would immediately notice the three resource-id spellings and ask which is canonical.

**Casey (Distracted Mobile)**: now also fighting genuine 196px horizontal drift in addition to the pre-existing 80%-of-page scroll to reach the verdict; 12 touch targets under 44px including the pagination Previous/Next pair at 29px tall.

## Minor Observations

- Three different `h2` sizes (16px main, 14px rail, 18px sidebar) for three different structural ranks — visual size contradicts semantic level.
- Source provenance renders twice, once in the coverage catalog and again in the sidebar.
- At true 1100px the main canvas narrows to 520px, forcing the proposal JSON into horizontal scroll within its own box — bounded, but cramped.

## Questions to Consider

1. If a reviewer could see only one thing per resource row, is it the address or `min_size: 2 → 4`? The layout currently answers "address."
2. What would the untrusted-context card look like rendered as a quarantined transcript, visually incapable of being mistaken for the tool's own voice?
3. Three spellings of one resource id crossed a package boundary to get here — is that a presentation bug, or a signal that findings should carry structured resource references rather than strings?
