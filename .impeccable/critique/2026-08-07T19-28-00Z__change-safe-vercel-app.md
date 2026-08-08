---
target: "https://change-safe.vercel.app/ (home / Network replay)"
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-07T19-28-00Z
slug: change-safe-vercel-app
---
Method: dual-agent (A: critique-home-A · B: critique-home-B)

> **Note on isolation**: A shared Playwright browser context caused a brief cross-contamination — B's overlay injection briefly appeared in A's first screenshot, and one of B's evaluate calls briefly landed on A's tab. Both agents caught it, self-corrected onto isolated tabs, and disclosed it. A deliberately under-reported anything matching the glimpsed overlay labels rather than risk contaminated findings, so a few real issues in that narrow space may be slightly under-counted below. Not a DEGRADED run — isolation held after the correction.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Real `aria-live` region and per-policy `loaded · not yet evaluated` state, but no findings-count summary — you scroll 7 cards to learn 1 blocked |
| 2 | Match System / Real World | 3 | Domain language fits infra engineers, but machine ids (`PATCH_SCHEMA`, `UNTRUSTED_INSTRUCTION`) lead each finding card ahead of their plain-language titles |
| 3 | User Control and Freedom | 2 | After a run, "Run replay" stays visibly labeled but is permanently disabled — no re-run, no reset; switching scenarios silently discards the prior result |
| 4 | Consistency and Standards | 3 | Strong card/eyebrow/`dl` system throughout; the disabled-but-still-labeled button is the one break |
| 5 | Error Prevention | 3 | Structural prevention is the product's whole point; loses a point because `?scenario=does-not-exist` silently substitutes the default with no notice |
| 6 | Recognition Rather Than Recall | 3 | Nothing icon-only, everything labeled; but none of the 9 scenario-picker items indicate which ones BLOCK |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no roving focus across the 9 scenario buttons, no deep link to an *evaluated* state |
| 8 | Aesthetic and Minimalist Design | 2 | Three raw, unformatted JSON dumps as primary content; type scale nearly flat (121/184 text nodes at 12px); confirmed by the detector's 13 nested-card hits and 1.8:1 `flat-type-hierarchy` finding |
| 9 | Error Recovery | 2 | The one recoverable error path (bad scenario id) recovers silently and wrongly — no visible error surface anywhere else |
| 10 | Help and Documentation | 2 | No glossary for the 7 policy ids, no link to docs/repo in the nav, "Sources" doesn't go to sources |
| **Total** | | **25/40** | **Acceptable — significant improvements needed before users are happy** |

No heuristic scored n/a (Operate surface with a persuade-adjacent landing role; all 10 apply).

## Design Specificity Verdict

**LLM assessment**: Authored for this product, genuinely — more so than most interfaces reviewed. The right rail is a chain of custody (Risk → Decision → Simulation → Receipt → Execution-outside-ChangeSafe), and that last panel exists solely to assert a safety invariant in status-field form ("Not performed or observed. ChangeSafe never executes infrastructure changes"). The Policy coverage table's tri-state (registered / loaded / evaluated-this-run) and the provenance `dl` (`Analysis mode: replay`, `Provenance: captured-replay`) render the project's honesty invariants as UI, not just docs prose. Where it goes generic: the same card-with-uppercase-eyebrow unit is applied uniformly across all 11 regions regardless of importance, and the three raw JSON dumps are the default-generic answer to "show the data."

**Deterministic scan**: 18 real findings after removing 2 self-detected false positives (see below), from an in-page detector run via a workaround (see Method note). Notable: `nested-cards` ×13 (10 real after excluding 3 `<thead>` hits that aren't cards), `line-length` ×5 (up to 174 chars/line), `flat-type-hierarchy` ×1 (11px–20px range, 1.8:1 ratio), `kicker-above-heading` ×1, `cramped-padding` ×1. These corroborate A's independent observations of a flat type scale and uniform card texture — detector and design review converged on the same root cause from different evidence.

**False positives caught**: `gradient-text` and `marquee` were the detector flagging its own overlay legend, not the page (verified: zero `<marquee>` elements, zero gradient-clipped text in a clean tab). 3 of the 13 `nested-cards` hits were bordered `<thead>` elements, not actual nested cards.

**Browser evidence**: Contrast is clean — 0 text nodes below WCAG AA across the whole page (worst case 4.56:1, on 11px eyebrow labels), which is genuinely good for a dark theme. 6 touch targets under 44×44 (all 5 nav links + the primary "Run replay" CTA sit at 36px tall). Mobile has no horizontal overflow; the wide table correctly wraps in a scroll container. Semantics are mostly solid (one `h1`, no unlabeled buttons, no missing alt) but the outline is flat — 14 consecutive `h2`s with no `h3`, so the sidebar's status items carry the same heading weight as the primary findings panel.

## Overall Impression

The blocked-state screen (`CRITICAL`, a red Decision panel reading "This proposal is unapprovable") is the best thing on the site and lands the product's entire thesis in one view — confident, unhedged, well-written. The problem is that a first-time visitor doesn't land there. They land on an un-run incident that resolves to all-green, three raw JSON blobs are the largest content mass on the page, and the actual verdict scrolls out of view the moment you read the evidence that produced it. The single biggest opportunity: make the comparison between a passing and a blocking scenario the thing visitors see in the first 10 seconds, not something they assemble across three clicks.

## What's Working

1. **The negative-status panels are a genuine design invention.** "Execution outside ChangeSafe → Not performed or observed," "Model generation → not run" — absence rendered as legible evidence rather than reassuring prose. No other product in this space does this.
2. **The blocked state doesn't hedge.** Red `CRITICAL`, a finding stating a change "can never be approved," no softened language — the UI refuses in the same voice as the project's own safety invariants.
3. **Accessibility fundamentals are deliberate.** Clean AA contrast everywhere, a visible focus ring, a genuine `aria-live` region narrating all three run phases, and a topology diagram correctly declared decorative with equivalent tables underneath.

## Priority Issues

**[P1] The landing state demonstrates the product *not* blocking anything**
Why it matters: this is the public trust-building surface, and the only state that proves the thesis (a BLOCK) is three interactions away in a 9-item undifferentiated list.
Fix: auto-run on load (measured ~280ms — the button gesture buys nothing) and land on or foreground a blocking scenario; add `BLOCKS`/`APPROVABLE` badges to every picker item.
Suggested command: `/impeccable onboard`

**[P1] The verdict scrolls away from the evidence that produced it**
Why it matters: both rails are `position: static` and 3078px tall with content only in the top ~450px, so `Risk: CRITICAL` and the Decision panel leave the viewport the moment you scroll into findings — the user has to hold the verdict in working memory while reading what produced it. On mobile the verdict doesn't appear until 84% down a 6658px page.
Fix: `position: sticky` on both rails; on mobile, hoist a compact verdict strip directly beneath the `h1`.
Suggested command: `/impeccable layout`

**[P1] Three raw JSON dumps are the page's default, largest content mass**
Why it matters: everywhere else the page renders machine facts as human evidence (findings cards, topology tables); here it pastes the payload instead, clipped mid-word in places. On a page arguing for rigor, this reads as "ran out of design budget." Corroborated by the detector's 13 nested-card / flat-hierarchy findings on the same regions.
Fix: collapse behind closed `<details>` with a one-line summary; render proposal fields as structured content like the Evidence panel already does, with raw JSON as a "view payload" escape hatch.
Suggested command: `/impeccable distill`

**[P2] An unknown scenario id silently substitutes the default incident**
Why it matters: the project's own provenance invariant says replay is "always labeled and never silently substituted" — a stale or mistyped shared link shows a different incident with no notice, directly contradicting a claim this audience will test and repeat.
Fix: show an explicit notice ("No scenario `X` in the bundled corpus. Showing INC-4821.") instead of silently rewriting.
Suggested command: `/impeccable harden`

**[P2] The primary button stays labeled "Run replay" while permanently disabled**
Why it matters: verified by polling through a click — it never re-enables. An active-voice label on a dead control reads as broken, not intentional; the only way out is a full page reload.
Fix: either re-enable it (the replay is deterministic and idempotent, so re-running is free and reinforces the determinism claim), or relabel to "Replay evaluated ✓" with a separate "Run again" control.
Suggested command: `/impeccable clarify`

**[P2] Type scale is too flat to carry the page's own hierarchy**
Why it matters: 121 of 184 text nodes sit at 12px, with `h1` at only 20px and 11 regions sharing one uppercase-eyebrow header treatment — confirmed independently by the detector's `flat-type-hierarchy` finding (1.8:1 ratio). Nothing on the page behaves like a headline except the Risk word, and it's exiled to a rail.
Fix: push `h1`/verdict to 28–32px, lift body to 13–14px, retire 10px text, and differentiate primary (findings/verdict) from reference (provenance/coverage) header weight.
Suggested command: `/impeccable typeset`

## Persona Red Flags

**Alex (Impatient Power User)** — closest match to the real audience: lands on an un-run page and must click before seeing anything (280ms replay, pure friction); cannot see two scenarios side by side since switching wipes the prior result; no roving focus or shortcuts across 9 scenario buttons; a shareable deep link always lands un-evaluated, so Alex can share "go here and press the button" but not "look at this BLOCK."

**Sam (Accessibility-Dependent)** — mostly well served: clean AA contrast, visible focus ring, one `h1`, a real `aria-live` region narrating run phases. But PASS/WARN/BLOCK scanning leans on color wash across 7 cards with no shape/prefix backup; the flat 14-sibling `h2` structure gives no signal that Risk/Decision/Simulation/Receipt belong to one rail; and the live region announces "evaluated through the deterministic gate" rather than the actual verdict, so Sam gets completion but must hunt for the result.

**Jordan (Confused First-Timer)** — relevant since this doubles as a landing page: finding cards lead with machine ids (`PATCH_SCHEMA`) ahead of plain titles; no docs/repo link anywhere in the nav; "Sources" anchors to a 4-row provenance table, not to sources; "Network / Terraform / Kubernetes / Authenticated self-hosted" mixes three technology domains with one auth-model distinction as if they were four peer categories.

## Minor Observations

- The left rail repeats the selected scenario's title as an `h2` directly above the highlighted list item containing it — three renderings of the same string on screen at once.
- The topology diagram's `⛨` protected-node marker has no legend; the tables below say "protected" in words, so the glyph looks like data but is decoration.
- All nav links and the primary CTA sit at 36px touch height (below the 44px guideline); the logo link is 24px.
- "Sandbox simulation capability: available" is immediately followed by "This public replay never requests sandbox simulation" — an available capability stated as available and then stated as never used, in adjacent sentences.
- `CASE STUDY` badges appear on 3 of 9 scenarios with no legend explaining what the badge means.

## Questions to Consider

1. Why does a 280ms deterministic replay need a button gesture at all? If the page auto-ran and let visitors switch between an approvable and a blocked case, the demo becomes a comparison instead of a form.
2. What if the negative-status panels ("cannot execute," "cannot approve," "cannot store your decision") were the loudest thing above the fold instead of 12px grey apologies at the bottom of a rail?
3. Who is the raw JSON for, and are they the same person reading the findings cards? Right now it serves neither audience while consuming the most vertical space on the page.
