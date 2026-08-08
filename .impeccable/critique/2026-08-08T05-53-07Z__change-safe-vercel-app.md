---
target: "http://localhost:3000/ (home / Network replay, pre-deploy, round 2)"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-08T05-53-07Z
slug: change-safe-vercel-app
---
Method: dual-agent (A: recrit2-home-A · B: recrit2-home-B) — second re-critique, checking the cross-page fix round

> **Note on what was tested**: local dev server (`http://localhost:3000/`), not yet deployed. Persisted under the production URL's slug for trend continuity.

## Change Ledger

**Fixed and independently verified twice (A and B's numbers agree to the decimal):**
- **Badge contrast** — BLOCK 5.65:1, WARN 7.50:1, PASS 7.45:1, all clearing AA. Confirmed structural, not tuned: the badge is now an opaque fill that cannot stack with an ancestor tint, unlike the translucent version that caused the original failure.
- **Sticky rail at laptop widths (1024–1279px)** — confirmed both by computed style (`position: sticky`) and, by B, a *functional* scroll test: the rail's `top` offset moved from 225px to 16px during a scroll and stayed pinned. Not merely declared correct — proven to work.
- **No regressions**: a full-page composited contrast sweep of the evaluated blocked state found exactly 2 failures, neither from this round's changes.

**Confirmed still broken (unchanged, out of scope this round):**
- "Replay evaluated" disabled-button label: 2.69:1 (B independently re-derived, matching the prior ~2.6:1 finding).
- Mobile verdict placement: 6,806px down an 8,569px page — the sticky fix only reaches 1024px and above; it was never going to touch mobile, and didn't.
- Three raw JSON dumps still dominate the center column, unaddressed.

**New findings from this round's changes, not previously caught:**
- **[P2] `PhasePill`'s state token still uses the old translucent pattern and fails AA** — `<code>BLOCKED</code>` inside the phase pill measures 3.14:1 (opacity-70 red text on a translucent red pill), below the 4.5:1 line the badge fix just established as the team's own standard three lines above it.
- **[P2] Focus order vs. visual order mismatch now reaches every laptop, not just ultra-wide screens** — lowering the grid breakpoint from `xl` to `lg` widened the reach of a pre-existing issue (DOM order is canvas→authority→context; visual order via `col-start` is context→canvas→authority) from ≥1280px to ≥1024px, which is the actual majority-share laptop viewport for this audience.
- **A measurement-integrity finding worth logging for future rounds**: A found that the *previous* round's "verified sticky at 1100px" claim was very likely measured at an actual 1375px viewport (the shared browser's 0.8 DPR inflates `setViewportSize(1100)` to a true ~1375 CSS width) — the fix happens to be correct at a true 1100px too, verified fresh this round, but the earlier verification claim itself rested on the wrong number.

## Design Health Score: **27/40** (unchanged — Acceptable)

The score holding flat is the honest result, not a measurement discrepancy: this round fixed a real P2 (badge contrast) and a real infrastructure gap (sticky breakpoint), both verified independently by two agents down to the decimal. But the two P1s actually gating this page's score — the un-run landing state and the buried mobile verdict — were explicitly out of scope this round, and lowering the breakpoint mechanically extended a pre-existing focus-order bug's reach from ultra-wide to ordinary laptop widths, adding one heuristic point of new cost while the fix added value elsewhere. Net heuristic movement is a wash.

## What's Working (this round's fixes specifically)

1. **The badge fix is structurally sound, not just re-tuned.** Both assessments independently derived the same three ratios from real computed styles, and the reasoning generalizes: an opaque fill cannot stack with whatever sits behind it, so this class of bug cannot recur here by construction.
2. **The sticky fix was verified functionally, not just declared.** B didn't stop at reading `position: sticky` off computed styles — a real scroll test proved the rail's offset actually moves and pins. That's the right level of rigor for a claim like this.

## Priority Issues (carried over, unaddressed this round — restated for continuity, not new work)

**[P1] Mobile verdict still sits at 6,806px of an 8,569px page**
The sticky fix closed the 1024–1279px gap but was never going to reach mobile, and confirmed it didn't: at true 390px the rail is `position: static`, unchanged from before. A phone user scrolls past 79% of the page — roughly 17 screens — before reaching Risk/Decision.
Fix: below `lg`, reorder the authority rail directly after the run controls, or hoist a compact verdict strip pinned under the header.
Suggested command: `/impeccable layout`

**[P1] Landing state still shows an un-run, all-PASS incident**
Unchanged. The product's most persuasive artifact (a deterministic BLOCK with remediation) remains two clicks away behind a form.
Fix: land pre-evaluated on a blocking scenario with a "Run it yourself" control.
Suggested command: `/impeccable shape`

## New Issues (surfaced by this round's changes)

**[P2] The phase pill's own state token still fails AA, at a lower ratio than what was just fixed**
Why it matters: `<code>BLOCKED</code>` inside the phase pill measures 3.14:1, using the exact translucent-tint pattern the badge fix just replaced — the page now has one component demonstrating the correct solid-fill standard and another, three lines above it, still failing below the line that standard was built to clear.
Fix: apply the same solid-fill treatment to the phase pill's state token, or drop the opacity reduction and let the pill's border carry the color instead of the text.
Suggested command: `/impeccable polish`

**[P2] Lowering the grid breakpoint widened a pre-existing focus-order bug's reach from ultra-wide to ordinary laptops**
Why it matters: DOM order (canvas → authority → context) has never matched the visual left-to-right order (context → canvas → authority, achieved via `col-start` reordering) — previously this only affected ≥1280px displays; the `lg` breakpoint change extends the mismatch to ≥1024px, the actual majority viewport for this audience, meaning more keyboard/screen-reader users now hit a scenario picker that's visually first but tabs last.
Fix: reorder the JSX to match visual order directly (context, canvas, authority) and drop the `col-start` overrides — the grid falls into correct order without them.
Suggested command: `/impeccable harden`

## Minor Observations

- Heading structure remains flat: one `h1` plus 14 sibling `h2`s with no `h3` anywhere, and one `h2` verbatim duplicates the `h1` text — a screen-reader user hears the page title announced twice at two different structural levels.
- At true 1100px the sticky rail measures 674px against a 675px viewport — it only just fits; on any shorter viewport in that range the rail would exceed the screen and the sticky behavior loses most of its value.
- "Replay evaluated" at 2.69:1 is technically WCAG-exempt as a disabled control, but both assessments argue this framing is beside the point: the label is the page's primary success signal, and making it the least legible text on screen is a usability defect independent of the exemption. Recommended fix is semantic (make it an enabled re-run control, or remove it and give the space to the verdict) rather than a contrast patch.

## Questions to Consider

1. The topology section already states "the diagram is decorative, the tables below carry the same evidence" and follows through. Why doesn't that same commitment extend to the proposal, current-state, and scenario-input JSON blocks?
2. The badge fix works because an opaque fill can't stack with whatever's behind it. What other component in this codebase still relies on a translucent tint whose contrast depends on unknown ancestor context — and should the fix pattern be applied there proactively rather than found one bug report at a time?
3. If a previous "verified at 1100px" claim rested on an actual 1375px measurement, what's the fastest way to make viewport verification (clientWidth/matchMedia cross-check) a default step rather than something each agent has to remember to add?
