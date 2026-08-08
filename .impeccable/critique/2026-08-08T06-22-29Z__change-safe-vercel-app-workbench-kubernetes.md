---
target: "http://localhost:3000/workbench/kubernetes (pre-deploy, round 2)"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-08T06-22-29Z
slug: change-safe-vercel-app-workbench-kubernetes
---
Method: dual-agent (A: recrit2-k8s-A · B: recrit2-k8s-B) — second re-critique, checking the cross-page fix round

> **Note on what was tested**: local dev server (`http://localhost:3000/workbench/kubernetes`), not yet deployed. Persisted under the production URL's slug for trend continuity.

## Change Ledger

**Fixed and independently verified twice, with the highest rigor applied to the P0:**
- **[P0 → resolved] Mobile horizontal overflow is genuinely fixed.** Both agents went beyond a `scrollWidth`/`clientWidth` comparison specifically because a parallel Terraform check just found that comparison alone can miss a real overflow hidden behind a correctly-scrolling container. Both ran a physical scroll test (`scrollTo(9999,0)`, checking whether `scrollX`/content position actually moved) with every `<details>` forced open, and both found zero movement and zero uncontained elements — the `min-w-0` chain (section → grid → article → DiffBlock root) holds under the exact conditions that broke it before.
- **Sticky rail at true 1100px** — confirmed functional (pins at `top: 16px` during a real scroll test), matching every other page's verification this round.
- **Diff screen-reader labels** — confirmed in this page's own DOM: `"removed: -     \"replicas\": 2,"` / `"added: +     \"replicas\": 3,"`, sr-only word paired with an aria-hidden glyph, context rows carry neither.
- **Badge contrast** — BLOCK 5.65:1, PASS 7.45:1 measured on a real rendered BLOCK, matching every other page. WARN could not be measured on a rendered badge (see below) but was synthesized from a live node and matched 7.50:1.

**Confirmed still broken (unchanged, out of scope this round):** the "Replay evaluated" button at 2.69:1 (both agents independently reproduced the opacity-compositing trap and flagged it as a UX rather than pure-conformance issue, consistent with every other page); no re-run affordance after evaluation.

**New findings, both about the same underlying gap:**
- **[P1] Every non-safe example on this page is CRITICAL — the gate's middle state is unreachable.** A confirmed this empirically by running all four bundled scenarios: outcomes are only `10 PASS / LOW` or `1 BLOCK + 9 PASS / CRITICAL`. Never MEDIUM or HIGH. This means the `APPROVAL_REQUIRED` decision path — the step where the product's own thesis says "a human decides" — is dead code on this surface, and B independently confirmed zero WARN badges render anywhere in the corpus exposed to the picker, even though the underlying scenario corpus has MEDIUM/HIGH examples (`scenario-w-mutable-image-tag`, `scenario-x-missing-verification`) that were never wired into the workbench picker.
- **[P2] The diff reuses the gate's own verdict colors for an unrelated meaning.** A found that `DiffBlock`'s `add`/`remove` line colors are the literal `text-pass` (PASS green) and `text-block` (BLOCK red) tokens — so on the protected-resource scenario, a reader sees BLOCK-red highlighting a line whose removal isn't what blocked anything. The design system's two most safety-critical colors now carry two unrelated meanings depending on which component you're looking at.

## Design Health Score: **27/40** (up from 26/40 — Acceptable)

| # | Heuristic | Score | Δ | Key Issue |
|---|---|---|---|---|
| 1 | Visibility of System Status | 3 | +0 | Phase pill, live status, `aria-busy` all solid; no re-run affordance after evaluation |
| 2 | Match System / Real World | 3 | +0 | Fluent K8s vocabulary; the diff's accessible name is a raw resource hash (`/resources/res-7994a176b0f510cc diff`) read aloud where a name belongs |
| 3 | User Control and Freedom | 2 | +0 | Cannot re-run without switching scenarios away and back; no expand/collapse-all across a page this long |
| 4 | Consistency and Standards | 3 | +0 | Now genuinely consistent with sibling pages post-fix, except the new diff-color collision with verdict semantics |
| 5 | Error Prevention | 4 | +0 | The product's strongest axis — no approval control exists at all, BLOCK is structurally unapprovable |
| 6 | Recognition Rather Than Recall | 3 | +1 | Everything is labeled; still fails on mobile where verdict and evidence are 9.6 screens apart |
| 7 | Flexibility and Efficiency | 2 | +0 | No shortcuts; three Previous/Next-only pagers with no page-jump or show-all |
| 8 | Aesthetic and Minimalist Design | 2 | +0 | Six evidence sections at byte-identical visual weight regardless of which one actually matters for a given verdict |
| 9 | Error Recovery | 3 | +0 | ERROR phase and unknown-scenario notice both handle failure well; copy is generic rather than diagnostic |
| 10 | Help and Documentation | 2 | +1 | Strong inline prose and a real policy-coverage catalog; still no glossary or docs link |
| **Total** | | **27/40** | **+1** | |

## Design Specificity Verdict

**LLM assessment**: Authored for this product, unusually so — but the bundled data undercuts the authoring. The rail's four consecutive sections stating what did *not* happen ("Not performed or observed. ChangeSafe never contacts this cluster...") render the product's safety invariant as a first-class, permanent UI element rather than a missing button — no generic dashboard produces this. What's category-interchangeable is the middle column: six evidence sections in identical chrome, rendered in the same order at the same weight regardless of whether the verdict is a protected-resource BLOCK or a clean LOW scale-up. The layout is a template being filled, not a case being argued — and because every non-safe scenario resolves to CRITICAL, the product's own three-state design system (`PhasePill`, `RiskValue`, WARN styling) only ever gets to exercise two of its three states on this surface.

**Deterministic scan**: 22 findings, zero self-detection verified three ways including a specific re-check of the known `text-occlusion` self-detection bug found on this page in the first re-critique — it remains latent (present in source, doesn't fire on this content) rather than newly fixed. `nested-cards` ×11 and `kicker-above-heading` both judged legitimate rather than defects: the nesting encodes the gate's real information structure, and the kicker is a provenance label the project's own honesty invariant requires to stay visible.

**Browser evidence**: the mobile-overflow re-verification is the strongest evidence gathered this round — both agents deliberately applied the exact rigor (physical scroll test, not just a dimension comparison) that had just caught a real bug on a sibling page, and both independently concluded this page's fix genuinely holds. The opacity-compositing trap on "Replay evaluated" (naive read ~7:1, true composited value 2.69:1) reproduced exactly as documented elsewhere.

## Overall Impression

The fix round did exactly what it claimed, verified the hard way: the P0 is dead, the sticky rail works, the diff is screen-reader readable. What's left isn't a defect list — it's a thesis problem. ChangeSafe's own framing is "AI diagnoses and proposes, deterministic code validates, a human decides," but on this page a human never decides and structurally never could, because every example is either fully clean or fully forbidden. The demo shows two-thirds of the product and stubs the third. The diff-color collision (verdict green/red reused for unrelated add/remove semantics) is a smaller but real instance of the same underlying issue: the design system's safety-critical vocabulary is starting to get reused for things that aren't safety verdicts.

## What's Working

1. **The refusal-as-content rail is the single most confident design decision on the page** — four sections stating precisely what did not happen and why it cannot, kept at full visual weight rather than collapsed into a footnote.
2. **Bounded evidence that admits it's bounded** — every pager states that deterministic evaluation covers the full snapshot regardless of what's rendered, closing a trust gap a plain "showing 10 of 154" would leave open.
3. **The `min-w-0` fix is structurally right** — applied at all four levels of the subtree rather than wherever made the symptom disappear, which is exactly why it survived the harder re-test with every disclosure forced open.

## Priority Issues

**[P1] The gate's decision state is unreachable — every non-safe example is CRITICAL**
Why it matters: verified empirically across all four bundled scenarios — outcomes are only LOW or CRITICAL, never MEDIUM or HIGH, meaning `APPROVAL_REQUIRED` (the step the product exists for) is dead code on this surface, and a visitor evaluating the gate learns it has two outputs, fine or forbidden, when the real product produces a graduated signal.
Fix: promote one MEDIUM-risk scenario from the existing `scenarios/kubernetes/` corpus (`scenario-w-mutable-image-tag` or `scenario-x-missing-verification`, both single-WARN cases) into the workbench's picker fixtures, so the default sequence spans LOW → MEDIUM → CRITICAL.
Suggested command: `/impeccable clarify`

**[P1] Mobile still puts the verdict 9.6 screens from the evidence that produced it**
Why it matters: measured at a true 390px on the blocked scenario with disclosures in their natural state — document height 9,467px, the Risk heading at y=8,128. The phase pill does appear on screen one, which is real progress, but Risk level, the decision explanation, and all four refusal statements are effectively unreachable without extensive scrolling, and the rail (754px tall) can't itself go sticky on a phone.
Fix: below `lg`, either reorder the rail to appear directly after the header via DOM order, or add a compact two-line `sticky top-0` verdict bar on mobile only.
Suggested command: `/impeccable layout`

**[P2] The diff reuses the gate's own PASS/BLOCK verdict colors for an unrelated meaning**
Why it matters: `add`/`remove` line colors are the literal `text-pass`/`text-block` tokens, so a reader sees BLOCK-red highlighting a removed line that isn't what caused the block — the two most safety-critical colors in the product now mean two different things depending on which component is on screen, undermining the very consistency the badge fix just established elsewhere.
Fix: give the diff its own neutral add/remove pair, reserving pass-green and block-red exclusively for verdicts; the sr-only labels already carry the semantic meaning, so the color is free to change without losing information.
Suggested command: `/impeccable colorize`

**[P2] Six evidence sections render at identical visual weight regardless of which one matters for the verdict**
Why it matters: findings, proposal, inventory, selectors, manifest diff, and coverage all share the same card chrome and rhythm — nothing signals that on a protected-resource BLOCK the finding is the story and the 154-resource inventory is background. Cognitive-load checklist fails 4 of 8 items, and the heading outline is one `h1` plus thirteen sibling `h2`s with no `h3` anywhere.
Fix: give findings elevated visual treatment; collapse inventory/selector sections under a single closed-by-default "Snapshot context" heading; introduce `h3` inside `<main>` so the outline reflects actual hierarchy.
Suggested command: `/impeccable distill`

**[P2] A replay cannot be re-run once evaluated, and the disabled control doesn't say why**
Why it matters: once a scenario resolves to BLOCKED or VALIDATED the button is permanently disabled reading "Replay evaluated" — a state, not a next step; the only recovery is switching scenarios away and back, which isn't discoverable.
Fix: re-enable as "Run replay again" in terminal phases (the transport is offline and idempotent, so this is free), or replace the disabled control with explicit guidance text.
Suggested command: `/impeccable clarify`

## Persona Red Flags

**Sam (Accessibility-Dependent)**: genuinely improved — diff markers carry verified sr-only labels, focus rings checked and confirmed real (not just present in class strings) across all 26 focusables. Remaining: thirteen sibling `h2`s with no `h3` give a flat heading list with no primary/secondary signal; the diff's accessible name is a raw resource hash where a name belongs; the selector table's horizontal scroll region has no keyboard-focusable wrapper at narrow widths.

**Casey (Distracted Mobile)**: the overflow that would have broken this page for her is confirmed gone even with every diff expanded — but the primary evidence is still a 9,467px scroll with the verdict 9.6 screens down; 12 tap targets under 44×44, worst being six 29px-tall pagination buttons sitting adjacent in a `flex gap-2` row (classic mistap geometry). Scenario state does survive a reload via the URL, a genuine point in her favor.

**Alex (Impatient Power User)**: no keyboard shortcuts anywhere; three independent search boxes with Previous/Next-only pagers, no page-jump or show-all; the permanently disabled Run replay button after evaluation reads as broken rather than intentional.

## Minor Observations

- The scenario title appears as both the `h1` and an `h2` in the examples rail — reads as a duplicate in a heading list.
- The selector table's horizontal scroll at narrow widths has no visual affordance (no fade, no shadow, no visible scrollbar until interaction) — correctly contained, but undiscoverable.
- `"154 captured offline resources"` as an `h2` puts a count where a subject belongs.
- The authority rail (754px) exceeds a realistic 1100×700 laptop viewport — Risk and Decision stay visible while Receipt and Cluster-contact fall off the pinned rail.

## Questions to Consider

1. The rail spends four sections saying what did not happen — what if one said what *could*, with a link to where a human actually can decide (the self-hosted workbench)?
2. If a reviewer only reads one section, it's Deterministic findings — why does it currently look exactly like the 154-resource inventory?
3. The scenario corpus already contains MEDIUM and HIGH Kubernetes examples. What decided the public workbench should ship only the two extremes?
4. What would this page look like if its layout changed with the verdict itself — a CRITICAL run leading with the blocking finding and collapsing everything else, a LOW run leading with the diff?
