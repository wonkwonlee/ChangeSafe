---
target: "http://localhost:3000/ (home / Network replay, pre-deploy)"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-08T04-29-27Z
slug: change-safe-vercel-app
---
Method: dual-agent (A: recrit-home-A · B: recrit-home-B2, after B's first attempt crashed mid-run and its orphaned live-server process on port 8400 was found and killed before relaunch)

> **Note on what was tested**: this run targeted the local dev server (`http://localhost:3000/`), which has the four committed fixes from the previous round but is not yet deployed to `change-safe.vercel.app`. Persisted under the same target slug as the production URL so the trend line tracks real progress toward what will ship.

## Verification of the four claimed fixes

| Claimed fix | Verdict |
|---|---|
| FindingsList sorts BLOCK first, red chrome, summary line | **Shipped, works.** Confirmed order (BLOCK, BLOCK, WARN, then 4 PASS) and a 3.75px red left border vs 0.625px on PASS, with "2 blocking · 1 warning · 4 passing" summary. |
| Sticky airlock rail | **Shipped, works — but only ≥1280px.** Pinned at `top: 16px` across six scroll positions on desktop; computes `position: static` at 390px and across the entire 1024–1279px range. |
| Unknown `?scenario=` notice + URL normalization | **Shipped, works well.** Names the bad id, names the substitute, dismissible, URL self-corrects. |
| Button reads "Replay evaluated" once disabled | **Shipped, but the label is nearly unreadable — ~2.6:1 contrast**, because it keeps full primary-button fill at `opacity: 0.5` instead of a muted completed-state treatment. |

## Design Health Score: **27/40** (up from 25/40 — Acceptable, top of band)

| # | Heuristic | Score | Δ | Key Issue |
|---|---|---|---|---|
| 1 | Visibility of System Status | 3 | +0 | Big improvement in kind (summary line, sticky rail, honest live-region text), held back by the 2.6:1 status label and rail going static on mobile |
| 2 | Match System / Real World | 2 | +0 | Finding titles are excellent plain language; everything around them (raw JSON, UPPER_SNAKE ids, undefined jargon) is unchanged |
| 3 | User Control and Freedom | 3 | +1 | Scenario switching free, notice dismissible, URL self-corrects |
| 4 | Consistency and Standards | 3 | +0 | Findings now severity-sorted while the coverage table below stays in evaluation order — a new, small inconsistency introduced by the fix |
| 5 | Error Prevention | 4 | +1 | The one bad-input path is now caught, named, explained, and corrected in the URL |
| 6 | Recognition Rather Than Recall | 3 | +1 | Coverage table is clearer; no scenario card still reveals its verdict up front |
| 7 | Flexibility and Efficiency | 2 | +0 | Deep-linking works, but run *state* isn't in the URL — a BLOCK still can't be shared directly |
| 8 | Aesthetic and Minimalist Design | 2 | +0 | Findings region is now genuinely well-composed; the three raw JSON dumps below it are untouched |
| 9 | Error Recovery | 3 | +1 | The unknown-scenario notice is close to textbook, docked only for missing `role="status"` |
| 10 | Help and Documentation | 2 | +0 | Unchanged |
| **Total** | | **27/40** | **+2** | |

## Design Specificity Verdict

**LLM assessment**: Authored for this product, and increasingly so — but only in one state. The blocked view is now unmistakably ChangeSafe: a policy id beside a plain-language verdict, an "Affected:" line, a remediation line, and the sentence "This proposal is unapprovable; public replay offers no override or decision action" — the entire trust model rendered as UI. But this specificity is opt-in: the default landing is still an un-run, all-PASS incident whose three most prominent blocks are unstyled JSON, so a first visitor's actual first impression remains generic.

**Deterministic scan**: 18 findings, zero self-detections this run (verified with a before/after overlay-injection count match: 18 both times). `nested-cards` ×13 judged mostly legitimate-by-design (11 real, 2 are a `<thead>` misread); `overused-font` flagged as a non-finding (a deliberate two-font system, both halves of a 100% split). `flat-type-hierarchy` (11–20px, 1.8:1) is unaddressed and corroborates A's type-scale finding independently.

**Browser evidence — new finding, not caught last round**: the fix's own BLOCK/WARN status badges fail WCAG AA when composited against their tinted card backgrounds: BLOCK badge measures **3.75:1** (needs 4.5:1), WARN **4.43:1** — meaning on a gate whose entire purpose is refusing unsafe change, **BLOCK is currently the least legible label on the page** while PASS passes at 6.30:1. This was caught only by correcting a color-parser bug mid-assessment (the app paints tints in `oklab()`, which a naive regex parser silently skipped, initially reporting a false "0 failures"). Touch targets: 7 of 16 interactive elements still under 44×44 (unaddressed), worst the 24px-tall wordmark link.

## Overall Impression

The single biggest fix — BLOCK-first sorting with distinct red chrome — worked, and worked well: the blocked state is now the strongest thing on the page, a real emotional peak. But three of the four fixes shipped correct-in-logic, imperfect-in-presentation: the button relabels but at unreadable contrast, the rail sticks but only above 1280px (mobile — arguably the persona most likely to need it — gets nothing), and the new BLOCK/WARN badges are themselves now an accessibility regression. None of these are hard to fix; all were introduced or exposed by this round's changes and weren't caught before shipping. The two carried-over P1s (all-PASS landing state, buried mobile verdict) are unchanged and remain the largest opportunity.

## What's Working

1. **The blocked state is now the strongest thing on the page.** BLOCK-first ordering, a 6× thicker red border, a scannable "2 blocking · 1 warning · 4 passing" summary, and remediation text per card — this is the fix that most changed the page, and it worked.
2. **The sticky rail fix is real on desktop**, verified pinned at `top: 16px` across six scroll positions on an 4894px-tall page with the Risk value visible throughout.
3. **Accessibility fundamentals remain unusually strong**: an honest `role="status"` live region, solid focus rings, a decorative topology diagram correctly marked with equivalent data tables.

## Priority Issues

**[P1] The landing state still demonstrates the wrong thing (carried over, unaddressed)**
Why it matters: the default load evaluates to 0 blocking / 7 passing — a gate that approves everything, on a product whose whole proposition is refusing unsafe changes. Now that the blocked state is genuinely excellent, the gap between what a visitor sees first and what the product actually does is wider, not smaller.
Fix: default to a pre-evaluated blocking scenario; badge every scenario card with its expected verdict so the corpus is browsable by outcome; put run state in the URL so a BLOCK can be shared directly.
Suggested command: `/impeccable shape`

**[P1] Mobile has no sticky rail, and the verdict sits ~6,800px down (new gap, exposed by this round's fix)**
Why it matters: the desktop fix for "verdict scrolls out of view" doesn't reach mobile at all — `position` computes to `static` below 1280px, so on a 390px viewport the authority panel lands at document y≈6815 of an 8578px page, past the findings, three JSON blocks, and two tables. This is arguably worse than the pre-fix desktop bug: at least the old desktop rail was visible once, before scrolling away.
Fix: on narrow viewports, hoist a condensed two-line verdict summary directly beneath the status chip, or use a sticky bottom bar in the thumb zone.
Suggested command: `/impeccable adapt`

**[P2] BLOCK and WARN status badges fail WCAG AA against their own tinted backgrounds (new — introduced by this round's fix)**
Why it matters: BLOCK measures 3.75:1 and WARN 4.43:1, both under the 4.5:1 requirement, while PASS passes at 6.30:1 — so the two severities that matter most are the hardest to read. This was only caught because the initial contrast pass silently returned a false "0 failures" (the app's `oklab()` color tints broke a regex-based parser); worth treating "0 failures" results with suspicion on this codebase going forward.
Fix: darken or desaturate the BLOCK/WARN badge backgrounds, or lighten the badge text, until both clear 4.5:1 against the tinted card fill they now sit on.
Suggested command: `/impeccable harden`

**[P2] The new "Replay evaluated" label is nearly unreadable (new — introduced by this round's fix)**
Why it matters: the relabel is correct, but the button keeps full primary-button fill at `opacity: 0.5`, putting the label at roughly 2.6:1 against its own background — the status message the fix was meant to deliver is the hardest text on the page to read, and it still looks like a broken primary action rather than a completed one.
Fix: replace the disabled-primary treatment with a quiet completed-state chip (muted surface, ≥4.5:1 text, a check glyph, no button affordance).
Suggested command: `/impeccable polish`

**[P2] Three raw JSON dumps remain the page's largest content (carried over, unaddressed)**
Why it matters: 11,271 characters across three unstyled 288px boxes sit between the findings and the verdict, expanded by default — on mobile this is the reason the verdict is 6,800px down, and it undercuts the "a human decides" half of the trust model by reading as a debugging tool rather than a review surface.
Fix: collapse behind disclosures stating what they contain ("Evaluated proposal · 1 operation, 4 evidence ids"); render the proposal's operations as a structured diff, matching the pattern already shipped for Terraform/Kubernetes.
Suggested command: `/impeccable distill`

## Persona Red Flags

**Jordan (Confused First-Timer)**: still lands on an all-PASS incident and would abandon before ever seeing a BLOCK; nine near-identical scenario cards carry no verdict signal; scrolls into 11k characters of raw JSON within two screens and reasonably concludes this is a developer tool.

**Casey (Distracted Mobile User)**: the verdict rail sits at y≈6815 of 8578 — the desktop sticky fix doesn't reach here at all; the Dismiss button on the new notice measures 60×25px, a single pixel over the WCAG 2.2 minimum and well under comfortable tap size; a refresh mid-session drops back to un-run since run state isn't in the URL.

**Riley (Stress Tester)**: signs off on the unknown-scenario fix — genuinely good (names the bad id, names the substitute, repairs the URL); notices the findings list is now severity-sorted while the coverage table below stays in evaluation order, with neither order labeled; finds no re-run control and nothing stating that re-running is deterministic.

## Minor Observations

- The findings summary and section eyebrows measure 4.56:1 at 11–12px, clearing AA by only 0.06 — the app's smallest text has almost no margin anywhere.
- The new unknown-scenario notice carries no `role="status"` — a one-line fix.
- WARN cards sit visually much closer to PASS than to BLOCK (a 0.625px amber border vs BLOCK's 3.75px red rule) — correct in priority ordering, but easy to skim past as a PASS.
- The un-run rail shows five consecutive negatives ("Not evaluated," "No decision has been made," "Not run," "Not created," "Not performed") — honest, but reads as a wall of nothing rather than confidence.
- An unverified anomaly: at 390×844 one region rendered blank in repeated screenshots while `getBoundingClientRect` reported it populated; the agent couldn't rule out shared-browser interference from a concurrent agent and did not score it — worth a thirty-second manual check on a real phone before treating it as real.

## Questions to Consider

1. What if the landing page opened already blocked — pre-evaluated, red rail, remediation visible — and "Run replay" existed only to prove a second run gives the identical answer?
2. The most persuasive sentence on the page ("This proposal is unapprovable...") currently appears only after a run, only on a blocking scenario, and never at all on mobile without eight swipes. Should that sentence be the largest text on the page?
3. Three of this round's four fixes were correct in logic and imperfect in presentation (badge contrast, button contrast, sticky breakpoint). Is there a review step — a contrast check, a mobile pass — that would catch "shipped but not finished" before the next round?
