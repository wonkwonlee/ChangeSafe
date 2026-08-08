---
target: "https://change-safe.vercel.app/workbench/kubernetes"
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-07T19-56-42Z
slug: change-safe-vercel-app-workbench-kubernetes
---
Method: dual-agent (A: critique-k8s-A · B: critique-k8s-B)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Excellent per-policy state transitions and live region, but switching scenario silently resets to unevaluated with no visible signal at scroll depth |
| 2 | Match System / Real World | 2 | Undefined jargon throughout ("blast radius warn at 2 · block above 2", "Contract 2.0.0") with zero tooltips or glossary — confirmed by detector's 0 `<abbr>` count |
| 3 | User Control and Freedom | 2 | No clear-search, no reset-to-unevaluated, no back-to-top on an 11,550px mobile page |
| 4 | Consistency and Standards | 3 | Cohesive card/paginator/`dl` system; one break is a sidebar `h2` (18px) outranking every content `h2` (16px) |
| 5 | Error Prevention | 2 | An unknown `?scenario=` value (a real fixture id, absent from the picker) silently loads a different scenario with the URL unchanged |
| 6 | Recognition Rather Than Recall | 2 | Findings cite `Affected: /resources/res-301e...` while the inventory lists `Service demo/web` — two identifier syntaxes for the same resource in adjacent cards |
| 7 | Flexibility and Efficiency | 2 | Real accelerators exist (deep links, search+pagination on all 5 collections), but zero keyboard shortcuts and the scenario picker is last in DOM/tab order despite being visually first |
| 8 | Aesthetic and Minimalist Design | 1 | BLOCK and PASS findings share an identical class string — differentiated only by an 11px colored word — confirmed independently by both assessments |
| 9 | Error Recovery | 2 | Finding copy is precise and non-blaming, but names no remedy and identifies resources by hash id rather than the human name used elsewhere |
| 10 | Help and Documentation | 2 | Strong explanatory prose in provenance/coverage panels, zero contextual help on any of the 10 policy ids |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

No heuristic n/a — full Operate surface.

## Design Specificity Verdict

**LLM assessment**: Specific in vocabulary, generic in composition. The three-state policy-coverage table (registered → loaded → evaluated·finding-returned) and the negative-space capability panel ("External read: unavailable," "Explicit policy skips: none") do real, unlifted work — no other product enumerates what it structurally cannot do this precisely. But the visual composition is a three-column admin shell on a palette that is functionally GitHub-dark; swap the ten policy names for ESLint rules and it reads as a linter report. The sharpest missed opportunity: Kubernetes protection here means a spec annotated `changesafe.dev/protected` cannot change *at all*, not even a one-replica bump — the single rule that would surprise a Kubernetes operator, and the one rule none of the three shipped examples demonstrates (`K8S_PROTECTED_RESOURCE` renders PASS in all three; the corpus's `scenario-v-protected-config-change` isn't in the picker, which instead spends a slot on a pagination proof).

**Deterministic scan**: 27 findings across 7 rules, verified with **zero false positives** this run (every finding's ancestor chain checked against the detector's own overlay classes — 0 overlay-hits, unlike the home-page and Terraform runs, which each had contaminated hits). Real findings corroborate A's independent read: `flat-type-hierarchy` (11–20px, 1.8:1) matches A's measured 156-of-230 leaf nodes at 12px; `nested-cards` ×11 (9 genuine, 2 softer `<thead>` matches) matches A's observation of a uniform card system; `cramped-padding` on the policy-coverage table wrapper.

**Browser evidence**: Contrast passes AA but by the thinnest margin seen across all three pages so far — 4.56:1 against a 4.5 requirement (1.3% headroom), on `text-ink-faint` carrying multiple eyebrow labels and pagination text; any future token nudge would break it, and the finding is systemic (7-foreground × 5-background token set) rather than a one-off. 14 of 17 interactive elements fail 44×44 at mobile width, worst being a 264×20 manifest-diff `<summary>` disclosure. Heading structure has no skipped levels but is semantically flat (13 sibling `h2`s at three different visual sizes) and duplicates "Safe web scale-up" as both `h1` and a larger-rendering `h2`. Semantics are otherwise strong: every section has an accessible name, every search input is properly labeled, 6 live regions present.

**Isolation note**: B's tooling briefly wrote to an unrelated stray tab mid-run (not A's tab) due to a non-atomic tab-select API; caught, repaired, and disclosed with verification. A's tab and viewport were never touched.

## Overall Impression

`CRITICAL` rendering at 24px in the right rail — the only text larger than the page's own `h1` — is the one genuinely satisfying moment on this page, and it's earned: the negative-space capability panel builds real trust before the reviewer ever clicks. But the trust is immediately spent hunting: the blocking finding is visually identical to nine passing ones (same border, same background, same class string — differentiated only by an 11px word), the "manifest diff" panel contains no diff (two unlinked JSON blocks where, on the safe-scale scenario, exactly 2 of 82 lines differ and the reader must find them by eye), and on mobile the verdict sits roughly eleven screens below the button that produced it. The biggest opportunity: make the categorical difference the product's whole thesis rests on — BLOCK vs. PASS — visible in the visual system, not just in an 11-pixel label.

## What's Working

1. **Negative-space disclosure is the best idea on the page.** "External read: unavailable," "Model generation: not run," "Explicit policy skips: none" — enumerating what the surface structurally cannot do, rather than just what it did, is the trust model rendered as UI and has no real analogue elsewhere.
2. **The three-state policy coverage table.** Watching all ten rows flip from "loaded · not yet evaluated" to "evaluated · finding returned" is the clearest, most legible feedback moment in the interface.
3. **Restraint verified under real load.** 153 resources and 150 workload matches don't blow up the layout; no horizontal page overflow at 390px even with wide tables present; copy explicitly states "search and paging bound only the rendered inventory," pre-empting the exact doubt a careful reviewer would have.

## Priority Issues

**[P0] A BLOCK finding is visually identical to a PASS finding**
Why it matters: the product's entire premise is that BLOCK is categorically different — it makes approval structurally impossible — yet the blocking card and nine passing cards resolve to the identical class string and border/background color, differentiated only by an 11px colored word (confirmed independently by both the design review and the detector's flat-hierarchy finding on the same region). Under time pressure a reviewer scanning ten near-identical boxes registers "a wall of green" and can miss the one red word.
Fix: give BLOCK its own card treatment (red border, tinted background, larger status label); sort findings severity-first with a summary line ("1 blocking · 0 warnings · 9 passing") above the list; make the blocking policy name a link that scrolls to its card.
Suggested command: `/impeccable bolder`

**[P1] The section labeled "manifest diff" contains no diff**
Why it matters: "what actually changes" is the review question, and the panel delegates that work back to the human — measured on the safe-scale scenario, exactly 2 of 82 total lines differ across two undifferentiated JSON blocks with zero `<ins>`/`<del>`/`<mark>` elements. A tool built around a transactional patch engine computes the diff internally and then withholds it from the one screen where it matters most.
Fix: render a real line-level diff with add/remove markers (symbol, not color alone); default to changed lines with context; state the change in one sentence above it ("replicas 2 → 3, image v1 → v2").
Suggested command: `/impeccable clarify`

**[P1] On mobile the verdict is roughly eleven screens below the button that produced it**
Why it matters: the page is 11,550px tall at 390px width; "Run replay" sits at y=656 and the CRITICAL verdict at y=10,346 — tapping the primary action produces no perceptible change from where the user is standing, and the DOM order compounds it by placing the scenario picker (needed first) dead last.
Fix: hoist a compact verdict strip beneath the button on narrow layouts and scroll it into view on evaluation; reorder the scenario picker above the canvas below the `xl` breakpoint; address touch targets in the same pass (nav links 36px, pagination buttons 30px, disclosures 20px — all under the 44px minimum).
Suggested command: `/impeccable adapt`

**[P2] The one Kubernetes rule unique to this product is never demonstrated**
Why it matters: "protected means it cannot change at all, not even one replica" is the counterintuitive, memorable rule an operator wouldn't predict — and it's the rule the shipped picker omits, spending a third of its slots on a pagination proof instead.
Fix: promote `scenario-v-protected-config-change` into the picker, displacing "Large manifest boundary" if three slots is the cap (bounded-rendering is already visible from the 153-resource inventory in every scenario); label it plainly ("Protected spec — even a one-replica bump is refused").
Suggested command: `/impeccable shape`

**[P2] An unknown `?scenario=` value silently loads a different scenario**
Why it matters: a real fixture id absent only from the picker renders "Safe web scale-up" with the URL still showing the requested id and no notice — directly undercutting the project's own stated invariant that replay is "always labeled and never silently substituted."
Fix: show a dismissible notice on an unrecognized id and rewrite the URL to the id actually loaded; expose the unsupported-manifest rejection path (a genuinely interesting demonstration) as its own reachable example.
Suggested command: `/impeccable harden`

## Persona Red Flags

**Alex (Impatient Power User, SRE triaging mid-incident)**: gets a wall of ten identical cards and must read every 11px pill to find the blocker — no count, no severity sort, no jump-to-blocker link; zero keyboard shortcuts; tab order reaches only 26 controls and puts the scenario picker last despite it being visually first; swapping scenarios silently discards the prior evaluation, so comparing two states means re-running from scratch each time.

**Sam (Accessibility-Dependent)**: genuinely well-served on fundamentals (correct focus indicators verified via real Tab presses, a `role="status"` region that announces the actual verdict, every search input properly labeled, every section has an accessible name) — better than most production dashboards. But visual and DOM order disagree for the scenario picker (WCAG 2.4.3/1.3.2), there's no skip link on an 11,550px mobile page, and findings reference a hash id while the inventory uses a human name with no programmatic link between them.

**Casey (Distracted Mobile User)**: taps "Run replay" and nothing appears to happen from where they're standing — the verdict is eleven screens down; every tap target is under 44px, worst being a 264×20 manifest-diff disclosure; if interrupted and returning, the scenario survives in the URL but the evaluated state doesn't, so the 11-screens-up button must be found and tapped again.

## Minor Observations

- The scenario title duplicates as both `h1` (20px) and a sidebar `h2` that renders *larger* (18px), inverting expected rank.
- `"confidence": 0` surfaces raw in the proposal JSON — on a page insisting model confidence never reaches a policy, a bare zero invites exactly the wrong interpretation.
- Findings render two different identifier syntaxes for the same resource in adjacent cards (`/resources/res-...` vs. `kubernetes-resource:res-...`).
- Nothing in the three-column grid is sticky; all children are `position: static` in a 4,280px row, so most of the left/right columns sit empty while their content scrolls out of reach.
- "Blast radius: warn at 2 · block above 2" is stated as a bare number with no unit or rationale — two *what*, and why is three too many?

## Questions to Consider

1. If a reviewer only reads one thing on this page, why isn't it the blocking finding — everything else (the 153-resource inventory, the proposal JSON) is corroboration for a verdict the page already computed, yet evidence and conclusion currently render as visual peers.
2. The gate's central claim is that BLOCK is categorically different from PASS — what would this findings list look like if it were designed by someone who believed that difference was unarguable, rather than encoding it in an 11px label?
3. You ship a policy and a corpus scenario that would genuinely surprise a Kubernetes operator (protected means *no* change, ever) — what is a public workbench for, if not showing the one thing only this product refuses that no one expects?
