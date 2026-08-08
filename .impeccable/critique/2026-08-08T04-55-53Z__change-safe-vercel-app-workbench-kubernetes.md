---
target: "http://localhost:3000/workbench/kubernetes (pre-deploy)"
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-08T04-55-53Z
slug: change-safe-vercel-app-workbench-kubernetes
---
Method: dual-agent (A: recrit-k8s-A · B: recrit-k8s-B)

> **Note on what was tested**: local dev server (`http://localhost:3000/workbench/kubernetes`), not yet deployed. Persisted under the production URL's slug for trend continuity.

> **Correction to a Assessment B claim**: B reported that `?scenario=kubernetes-service-selector-break` (an id that doesn't exist in the corpus — the real id is `kubernetes-selector-red-team`) fell back to the default "silently, with no notice." I verified this myself directly after the reports came in: the fallback banner ("No example named...") does render, and `hasNotice: true` on the actual page content. This appears to have been a stale-tab-reference artifact on B's side (the shared browser's tab drift affected every agent this session) rather than a real regression — treated as a false negative below, not a finding.

## Change Ledger

**Fixed, verified on this page specifically:**
- **[P0 → resolved] BLOCK vs PASS is now unmissable** — confirmed on three separate scenarios (protected-resource-change, selector-red-team, large-manifest-boundary): 3.75px red left border + red tint + severity-first sort + "1 blocking · 0 warnings · 9 passing" summary, categorically distinct from PASS cards.
- **[P1 → resolved] The manifest diff is a real diff** — verified exactly two non-context lines (`- "replicas": 2,` / `+ "replicas": 3,`) plus a one-line `spec.replicas: 2 → 3` summary on the protected-resource scenario.
- **[P2 → resolved, "the best thing on the page"] The Kubernetes-specific protected-resource rule is now demonstrated** — a single-replica bump on an annotated Deployment blocks with concrete remediation, teaching the domain's most counterintuitive rule in a one-line diff.
- **[P2 → resolved] Unknown-scenario handling is honest** — notice names the bad id and the substitute, dismissible, URL self-corrects.

**Cross-page defects, checked here specifically:**
- **Badge contrast — does NOT reproduce on this page.** Full ancestor-chain compositing gives BLOCK 5.05:1, PASS 7.40:1, both clear AA — differs from the home/Terraform pages, likely due to a different background-layer stack on this page's cards. WARN is untestable here (see new P2 below).
- **Sticky breakpoint (`xl:`, ≥1280px) — reproduces, and is worse than "mobile only."** At a verified 1024×800 (a laptop, not a phone) the rail is `position: static` and the verdict sits 6.7 screens down.
- **`aria-hidden` diff markers — reproduces.** Confirmed in the DOM at `DiffBlock.tsx:72`; a screen reader hears identical added/removed lines with no distinguishing signal.
- **Leaf-summary trapped in collapsed disclosure — structurally reproduces but is inert here.** All rendered cards on this page are `add` operations, which `DiffBlock` treats as a root replacement and suppresses the summary for regardless of collapse state — so nothing useful is actually being hidden on this specific page.

## Design Health Score: **26/40** (up from 21/40 — Acceptable)

| # | Heuristic | Score | Δ | Key Issue |
|---|---|---|---|---|
| 1 | Visibility of System Status | 3 | +0 | Phase pill and live region both work; verdict itself sits 6.7–7.7 screens from the button below 1280px |
| 2 | Match System / Real World | 3 | +1 | Kubernetes vocabulary is exact; "blast radius," "contract 2.0.0" still arrive undefined |
| 3 | User Control and Freedom | 2 | +0 | No re-run without a page reload; no way to collapse unrequested inventory |
| 4 | Consistency and Standards | 3 | +1 | Shared components pay off consistently; auto-open vs. closed disclosures give no visible cue why they differ |
| 5 | Error Prevention | 4 | +1 | BLOCK is unapprovable at the domain layer, not just the UI |
| 6 | Recognition Rather Than Recall | 3 | +1 | Better labeling overall, but a resource id must still be carried by eye across three screens |
| 7 | Flexibility and Efficiency | 2 | +0 | Deep links work well; no shortcut, filter, or finding→diff jump |
| 8 | Aesthetic and Minimalist Design | 1 | +0 | 9.3 mobile screens for a page that answers one question; a 154-row inventory and nested 150-workload pager carry the same weight as the single BLOCK |
| 9 | Error Recovery | 3 | +1 | Unknown-scenario notice is exemplary |
| 10 | Help and Documentation | 2 | +0 | Excellent trust-model copy; no glossary for any policy id |
| **Total** | | **26/40** | **+5** | |

## Design Specificity Verdict

**LLM assessment**: Authored, not category-interchangeable, and more so than last round. The airlock rail's "Cluster contact or apply → Not performed or observed" is the product's thesis rendered as a negative status field — no generic dashboard produces this. The protected-resource fixture now demonstrates the domain's single most counterintuitive rule (protection freezes the spec entirely, not just deletion) in exactly one diff line, which is as sharp as product storytelling gets. The exception is the page's middle third: a 154-resource inventory and a Service-selector table with a pager nested inside a table cell are ordinary admin-console furniture that could belong to any Kubernetes tool, and occupy roughly half the page's height.

**Deterministic scan**: 29 raw findings, 4 confirmed self-detections (the detector's `text-occlusion` rule doesn't apply the same overlay-exclusion skip-list its other rules use — a detector bug, not an app defect, verified two independent ways: ancestor-chain match and identical before/after-overlay counts). Real count: 25, including `flat-type-hierarchy` (11–20px, 1.8:1) corroborating both assessments' hierarchy complaints, and 11 `nested-cards`.

**Browser evidence**: Both mobile-viewport traps from prior runs reproduced and were caught the same way (setViewportSize silently zoomed; a naive overflow scan false-flagged the correctly-contained inventory table). Genuine finding: the page has real, uncontained horizontal overflow (see new P0 below) — different from the false positive.

## Overall Impression

This is the strongest round of fixes yet — three of four prior issues are cleanly resolved and independently verified, and the protected-resource fixture is the single best piece of product storytelling shipped so far in this whole review cycle. But the round also introduced a genuine new P0: the page now scrolls horizontally on a real phone, traced to a specific missing `min-w-0` in the diff-rendering subtree. Combined with the still-unfixed sticky-rail breakpoint and the cross-page `aria-hidden` bug, the pattern from the last two pages holds: strong logic, incomplete finishing.

## What's Working

1. **BLOCK vs. PASS is now categorically distinct**, verified on three separate scenarios — not a color-only difference but a different card entirely.
2. **The protected-resource fixture is the best product storytelling shipped this cycle.** A single-replica bump blocking, proven in a one-line diff, teaches the domain's most surprising rule better than any amount of prose could.
3. **The diff correctly renders a real two-line change** (`- "replicas": 2` / `+ "replicas": 3`) with an accurate one-line summary.

## Priority Issues

**[P0] The page scrolls horizontally on a real phone (new defect, introduced this round)**
Why it matters: verified at a true 390px viewport, `document.scrollWidth` is 481 against a 390px client width — 91px of whole-page horizontal scroll, confirmed behaviorally (`scrollTo` genuinely moves the viewport sideways). Traced to the manifest-diff subtree: `DiffBlock`'s own root has `min-w-0`, but the `<section>` and grid wrapping it in `KubernetesWorkbenchShell.tsx` (lines 298, 484) don't, so a 432px-wide `<article>` escapes containment and drags the whole page sideways. A page whose entire purpose is careful reading of a safety verdict is now physically unstable to read on the device most reviewers will first open it on.
Fix: add `min-w-0` to the manifest `<section>` and the diff grid's root and each `<article>`; add a Playwright assertion that `scrollWidth === clientWidth` at 390px so this can't regress silently again.
Suggested command: `/impeccable adapt`

**[P1] Below 1280px the verdict is still 6.7–7.7 screens from the button that produces it (carried over, narrowed but not fixed)**
Why it matters: improved from ~11 screens to 7.7 purely because the diff got shorter, not because of a layout decision — the sticky rail still only engages at `xl:` (1280px), so both mobile and 1024px laptop widths get nothing. The material a reviewer actually decides on (CRITICAL, BLOCKED, unapprovable) sits past a 154-row inventory, a 150-workload nested pager, and a 10-row coverage table.
Fix: lower the sticky breakpoint to `lg:` (1024px) for laptops; below that, hoist a compact Risk/Decision strip directly beneath the Run button, or make it a `sticky bottom-0` bar.
Suggested command: `/impeccable layout`

**[P1] The diff's +/- markers remain hidden from screen readers (cross-page defect, confirmed here too)**
Why it matters: confirmed in the DOM — the marker is the only non-color signal distinguishing an added line from a removed one, and `aria-hidden` removes it from exactly the users who need it, directly inverting the component's own code comment.
Fix: drop `aria-hidden`, or pair the glyph with a visually-hidden "removed"/"added" word.
Suggested command: `/impeccable harden`

**[P2] Everything except the verdict is fully expanded before the verdict exists**
Why it matters: on first load — before any evaluation — the page already renders a 154-resource inventory with its own pager, a Service-selector table with a *second* nested pager for 150 workloads inside a table cell, and a manifest diff with a third search box, while the findings panel says only "appears after evaluation." Four search boxes and four pagers are live before the primary action is even taken — a checklist failure on 5 of 8 cognitive-load items.
Fix: collapse the inventory and selector-relationship panels behind closed disclosures until a replay has run, labeled with their counts; auto-open only what a finding actually references afterward.
Suggested command: `/impeccable distill`

**[P2] No Kubernetes scenario can produce a WARN, so the middle of the risk model is never demonstrated (new observation)**
Why it matters: all four bundled scenarios resolve to either all-PASS or exactly one BLOCK — the documented "1 WARN → MEDIUM, ≥2 WARN → HIGH" ladder is unreachable on this page, which also means the WARN badge's contrast (the one thing most worth re-checking after the cross-page finding) couldn't be tested here at all.
Fix: add a fifth scenario that produces exactly one WARN — a blast-radius-of-2 change is the cheapest route given the domain's own `warn at 2 · block above 2` threshold.
Suggested command: `/impeccable clarify`

## Persona Red Flags

**Sam (Accessibility-Dependent)**: diff +/- markers are `aria-hidden`, so added/removed lines announce identically; a pager nested inside a `<td>` fractures table navigation mode in most screen readers. Genuine strengths: focus correctly lands on the phase pill after evaluation, verified via `document.activeElement`; every control is a real `<button>`; the picker uses `aria-pressed`.

**Casey (Distracted Mobile)**: the page now scrolls sideways 91px, so vertical one-handed scrolling drifts horizontally; the verdict sits 7.7 screens down with the scenario picker even further at 8.4; 12 of 16 buttons measure under 44×44; a returning user after evaluating must reload the page to re-run, since the button is permanently disabled with no reset.

**Alex (Impatient Power User)**: no keyboard shortcut to run the gate, no "blocking only" filter across ten findings, no link from a BLOCK finding to the diff line that caused it — must carry a resource id by eye across three screens; four separate search boxes with no global search; deep links remain the one genuine accelerator and work well.

## Minor Observations

- The BLOCK finding's `id` attribute (`finding-K8S_PROTECTED_RESOURCE`) already exists as an anchor target — nothing links to it yet, so wiring the summary line's counts to scroll there would be nearly free.
- Two visually-identical disclosures behave differently (`open` on remove/replace, closed on add/update) with no visible cue explaining why.
- The runtime-variant panel's reassuring copy ("Offline snapshot · no cluster contact") is styled in the same amber family as a WARN finding, so a safety guarantee reads as a caution.
- "Showing 1–20 of 150 workloads" lives inside a table cell that is itself inside a paged table — three levels of pagination on one screen.

## Questions to Consider

1. If the airlock verdict is the product, why is it a sidebar? At every width below 1280px it's literally the last thing on the page — what would this look like if Risk and Decision were the first things under the `<h1>`?
2. Does a reviewer need 154 resources and 150 workload matches *before* running the gate, or only the ones a finding touches, after?
3. The protected-resource scenario teaches its rule in a single diff line — could the other three scenarios be that sharp, or is 82 lines of JSON context earning its height?
