---
target: "http://localhost:3000/workbench/self-hosted (pre-deploy, round 2)"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-08T06-34-30Z
slug: change-safe-vercel-app-workbench-self-hosted
---
Method: dual-agent (A: recrit2-sh-A · B: recrit2-sh-B) — second re-critique, checking the cross-page fix round

> **Note on what was tested**: local dev server (`http://localhost:3000/workbench/self-hosted`), default disconnected state, not yet deployed. Persisted under the production URL's slug for trend continuity.

## Scope check, verified before anything else

The cross-page fix round touched `DiffBlock.tsx`, `StatusTone.tsx`, and the three public workbench shells — none of which render in this page's disconnected state. Both agents independently confirmed this by inspecting the actual commit diff and the live DOM rather than assuming it. One nuance A caught: `SelfHostedReviewDetail.tsx` (the *connected*-state component, not rendered here) does import `FindingsList`, so the badge fix silently reached this page's other state — the disconnected explainer just isn't that state. No accidental regression, no accidental fix, either.

## Change Ledger

**Confirmed unchanged (all four re-verified live, matching the prior round exactly):**
- [P1] page header still describes a queue this state doesn't render
- [P1] a real `configurationError` still replaces the fix instructions instead of joining them
- [P2] the two outbound links still measure 16px tall (B: re-verified at a true 390px, unchanged from last round, and additionally fails WCAG 2.2's 24×24 minimum, not just the 44px guideline)
- [P2] the fictional-receipt safeguard is still a prose comment, not a code assertion

**Provenance honesty (safety invariant 10): re-verified intact, no regression.** Both agents independently confirmed the example receipt's values remain obviously synthetic (repeated-character hashes, `-example-` ids) under the permanent "Example" badge and disclaimer. B ran this as a specifically high-priority check given the safety stakes and found nothing changed.

**New findings this round:**
- **[P2] The receipt-proof panel cannot visually distinguish a failing claim from a passing one.** A found `SelfHostedReceiptProof.tsx` renders every claim status (`verified`, `present`, `valid`, `included`) as identical `text-ink font-semibold` — no tone, no color, nothing but the word itself. This is the exact bug class the cross-page fix round just eliminated elsewhere (`StatusBadge`'s move to solid-fill tone), but this component rolls its own chrome and wasn't touched, so it now diverges from the rest of the design system it's supposed to demonstrate.
- **[P2] The page has no ending.** A measured content terminating at y=1002 on tall viewports with a large empty region below and no closing call-to-action — a visitor the page has just persuaded has nowhere to go except scrolling back up to a 16px link they may have already passed.

## Design Health Score: **27/40** (prior round: 28/40 — treat as scoring noise, not regression)

Both the fixing agent and this round's reviewer agree nothing on this page changed. A explicitly frames the 1-point difference as noise between two independent scoring passes rather than a real movement — the same conclusion reached on other unchanged axes this cycle. The heuristic table is materially identical to last round's; see the previous snapshot for the full breakdown.

## Design Specificity Verdict

**LLM assessment**: content strongly product-specific, composition largely generic — with one exception worth naming precisely. The receipt-proof panel is the page's single most product-specific asset (a real production component rendering a live claim-verification argument) and is now also its least designed: five identical rows differentiated only by which word appears, on a page whose entire thesis is that these claims are independently and visibly checkable. The sibling public workbenches just shipped a solid-fill status system for exactly this problem; this panel wasn't in scope and now reads as the one place the product's own trust argument doesn't practice what it demonstrates elsewhere.

**Browser evidence**: 0 status badges exist on this page (confirmed by B via exhaustive pill-shape scan, not assumption) — the cross-page badge-contrast fix is simply inapplicable here. Contrast: 44 elements, 0 AA failures, thinnest margin 4.99:1 — coincidentally on the disclaimer text that marks the fictional receipt as fictional, which A separately flags as backwards (the marker is quieter than the thing it marks). No horizontal overflow at a physically-tested true 390px (four independent methods, including a real scroll attempt across all 116 nodes).

## Overall Impression

This page is stable, not stagnant — nothing regressed, provenance honesty holds under renewed scrutiny, and the four carried-over issues are exactly where they were, with clear, unchanged fixes proposed for each. The two new findings both point at the same underlying pattern this whole re-critique cycle keeps surfacing: a shared fix (solid-fill status tone) that was applied cleanly to the components it touched, but not to the ones structurally similar to them that happened to sit outside this round's scope. The receipt-proof panel is the clearest instance yet — it's the one component on this page that most needs the exact treatment three other pages just received.

## What's Working

1. **"Empty by design — not broken" remains the right sentence** — re-verified as the single best copy decision on the page, naming the visitor's likely assumption before they form it.
2. **Provenance honesty holds under renewed, specifically-prioritized scrutiny** — both agents treated this as the highest-stakes check on the page and found nothing changed.
3. **Mobile structure is genuinely clean** — zero overflow verified four independent ways, every focusable carries a real visible outline, the fictional-receipt disclaimer stays on-screen alongside the claims it qualifies at 390px.

## Priority Issues (carried over, restated for continuity — not new work)

**[P1] The page header still describes an application this state doesn't render** — unchanged, same fix proposed: branch the H1/subhead/banner copy on `transport`.
Suggested command: `/impeccable clarify`

**[P1] A real configuration error still replaces the fix instructions instead of joining them** — unchanged, same fix proposed: render the error as a leading line with the instructions kept beneath it, naming the specific failed constraint.
Suggested command: `/impeccable harden`

## New Issues

**[P2] The receipt-proof panel can't show a claim failing — the exact bug the shared fix just eliminated elsewhere, in a component that fix didn't reach**
Why it matters: this panel is the page's central argument and, going forward, the same component an operator will rely on in the connected state to spot a broken chain at a glance — but every claim status renders identically regardless of whether it passed or failed, teaching the wrong lesson about what receipt proof demonstrates.
Fix: route claim status through the same solid-fill tone system `StatusBadge` now uses (verified/valid/included → pass tone, absent/unknown → warn, failed/broken → block), keeping the word and adding the tone — without reintroducing the translucent tint the earlier fix specifically eliminated.
Suggested command: `/impeccable polish`

**[P2] The page ends abruptly, with no path forward after conviction peaks**
Why it matters: content terminates with a large empty region below it on tall viewports, and the only forward action is a 16px link a visitor may have already scrolled past — the page persuades and then strands the reader exactly where a closing action would land best.
Fix: repeat the self-hosting guide link as a real button at the end of the explainer, sized correctly (also resolves the touch-target issue below in the same change).
Suggested command: `/impeccable layout`

**[P2] Carried over: the two outbound links are still 16px tall, and now confirmed to fail WCAG 2.2's 24×24 minimum outright, not just the 44px guideline**
Fix: unchanged — `min-h-[44px]` inline-flex with real padding, or promote to bordered secondary buttons.
Suggested command: `/impeccable polish`

**[P2] Carried over: the fictional-receipt safeguard is still a comment, not a test assertion**
Fix: unchanged — assert the shape (`/^(.)\1{63}$/` on hashes, a literal `-example-` prefix on ids) rather than the prose, so the safeguard fails loudly if a future edit makes the example "more realistic."
Suggested command: `/impeccable harden`

## Persona Red Flags

**Sam (Accessibility-Dependent)**: best-served persona on this page, with one hard failure carried over — all six focusables have real visible outlines, heading order is clean, the claims list is a proper `<dl>` with a real accessible label, all measured text passes AA. But the two outbound links are 16px tall and are the only content-level interaction on the page, so a visitor with a motor impairment may be able to see and focus them but not reliably activate them.

**Alex (Power User)**: needs the one string that matters (`CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL`) with no copy affordance, and clicking either outbound link has no `target`, so navigating away loses the page (and the env-var name) entirely.

**Project persona — the evaluating infra engineer**: gets a clean argument for self-hosting and a concrete receipt-proof example, then hits the page's dead end with no quick-start command and no prominent link to the actual setup guide — the page persuades her and then has nowhere left to send her.

## Minor Observations

- The security rule is still stated twice in adjacent, differently-worded paragraphs — unresolved from last round.
- Two content widths at wide viewports: header text constrained to `max-w-3xl` (ending at x=792) while the card grid runs to x=1476, a 684px discrepancy reading as two stacked documents.
- The "Example" chip (`bg-warn/10 border-warn/50 text-warn`) is the exact translucent-tint idiom the shared fix eliminated from `StatusBadge` — it happens to measure fine here (6.98:1) only because it sits on an untinted background, which is coincidence rather than the structural immunity the fix elsewhere was built to guarantee.
- The fictional-receipt disclaimer (11px, 4.99:1 — the thinnest AA margin on the page) is visually quieter than the fake hashes it's disclaiming (12px, 6.5:1).

## Questions to Consider

1. If the disconnected state is what nearly every visitor actually sees, is it the fallback, or is it the real page — with the connected workbench as the special case? Building it as primary would resolve the header contradiction by construction rather than by branching logic.
2. What would this page look like if the receipt-proof example were interactive — a toggle between a clean receipt and a broken chain? The product's whole claim is that tampering is detectable; showing a `failed` claim in block tone would demonstrate that claim rather than just assert it, and would force the status-tone fix as a natural side effect.
3. Should a visitor who will never self-host see the env-var instructions at all? Collapsing them behind a "Running your own server?" disclosure would cut the header from four paragraphs to two and let the value props occupy the position the warning banner currently holds.
