---
target: "http://localhost:3000/workbench/self-hosted (pre-deploy)"
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-08T05-04-16Z
slug: change-safe-vercel-app-workbench-self-hosted
---
Method: dual-agent (A: recrit-sh-A · B: recrit-sh-B)

> **Note on what was tested**: local dev server (`http://localhost:3000/workbench/self-hosted`), default disconnected state (no gateway configured), not yet deployed. Persisted under the production URL's slug for trend continuity.

## Provenance-honesty verdict: no violation found

Both assessments were specifically tasked with checking whether the fictional example receipt could be mistaken for a real one, given the project's provenance-honesty invariant. **Neither found a violation.** A confirmed four independent, un-toggleable signals: a dashed-border card (the only dashed border on the page), a permanent amber "Example" badge, an explicit disclaimer ("Fictional claims for illustration only — not a real review, not signed by any key"), and self-evidently synthetic values read directly from the rendered DOM (`eeee…`×64, `aaaa…`×32, ids like `review-example-0000000000000000`, "Sequence 42"). B independently confirmed zero BLOCK/WARN/PASS badge text exists anywhere on this page, so the cross-page badge-contrast defect found on other pages does not apply here.

## Change Ledger

**Fixed, verified on this page:**
- **[P0 → resolved] The disconnected shell no longer renders — it's genuinely replaced.** A confirmed via source: `{!transport ? <SelfHostedDisconnectedExplainer /> : <fullApp>}` is a real ternary, not a conditional style. Total tabbable elements on the disconnected page: 6. No intake form, no submit button, no queue region exists in the DOM at all.
- **[P0 → resolved] Zero outbound links → two working links.** Both verified real: a self-hosting guide (repo file exists, 141 lines, covers OIDC and deployment) and the repo root.
- **[P1 → resolved] Audience-appropriate messaging.** The banner now leads with a visitor-facing sentence before the operator-facing env var instruction, ending on "empty by design — not broken," which both assessments credit with doing real reassurance work.

**Cross-page defect, checked and does not apply here:** the BLOCK/WARN badge contrast failure found on other pages — B confirmed zero status badges render on this page at all, so the defect has no surface here.

## Design Health Score: **28/40** (up from 20/40 — Good, lower edge)

| # | Heuristic | Score | Δ | Key Issue |
|---|---|---|---|---|
| 1 | Visibility of System Status | 3 | +1 | State is clearly explained, but the banner still says "the queue below is empty by design" when no queue exists below it anymore |
| 2 | Match System / Real World | 3 | +1 | Lead sentence is now visitor-facing; the H1 and subhead still promise UI (intake/decide/inspect) this state doesn't render |
| 3 | User Control and Freedom | 3 | +0 | Two real outbound links exist; no route to the working public demo from this page |
| 4 | Consistency and Standards | 3 | +0 | Reuses the real production receipt-proof component rather than a mockup — a genuinely strong consistency choice |
| 5 | Error Prevention | 3 | +0 | Security guidance (HTTPS, no credentials) is explicit, though stated twice nearly verbatim |
| 6 | Recognition Rather Than Recall | 3 | +1 | Shows an example instead of describing one; env var still has no copy affordance |
| 7 | Flexibility and Efficiency | 2 | +1 | Single path, no accelerator at the moment an operator is mid-setup |
| 8 | Aesthetic and Minimalist Design | 3 | +1 | The dead three-pane shell is gone; three stacked explanatory paragraphs still precede content, plus ~430px of trailing empty canvas |
| 9 | Error Recovery | 2 | +0 | A real configuration error currently *replaces* the fix instructions instead of joining them — the operator who's actually stuck loses the guidance they need most |
| 10 | Help and Documentation | 3 | +1 | Two working doc links where there were zero; both undersized as touch targets |
| **Total** | | **28/40** | **+8** | |

## Design Specificity Verdict

**LLM assessment**: Authored for this product — the largest specificity gain of any page re-checked this cycle. The generic version of this screen is "Not connected — configure your server"; this is precisely what it no longer is. The value-prop column names claims only ChangeSafe can make (OIDC-bound approver identity, server-recomputed findings, out-of-band-checkable Ed25519 receipts, hash-chained ledger inclusion), and rather than mocking up a proof panel, it feeds the fictional example through the **actual production `SelfHostedReceiptProof` component** — so the preview can never structurally drift from what a real one would show, and it stays honest for free because the component only renders what the schema allows. Feeding real UI real (if fictional) data is a sharper decision than either assessment's brief asked for.

**Deterministic scan**: 12 findings, zero self-detection confirmed two ways (ancestor-chain check and identical before/after overlay counts). One important negative result: the known `text-occlusion` self-detection bug (found on the Kubernetes page) simply never fires here, because this page has no occluded text to trigger it — B was careful to flag this as "latent, not fixed" rather than claiming the detector bug is resolved. Two false positives identified and explained: `overused-font` flagging "100% geist" is a miscalibration for a deliberately single-typeface audit tool; a `line-length` finding on the four value-prop descriptions is real but width-conditional (desktop two-column layout only).

**Browser evidence**: Contrast is clean — 0 of 44 text elements fail AA (minimum 4.99:1), parser validated against boundary-straddling control pairs first. Touch targets: the two new outbound links (the page's whole reason for existing now) measure only 16px tall — technically pass WCAG 2.2's spacing-exception clause given their separation, but are the weakest targets on the page at roughly a third of a comfortable thumb target. No horizontal overflow at a CDP-verified true 390px viewport.

## Overall Impression

The P0 is genuinely dead, and it was fixed at the right altitude — a structural replacement, not a cosmetic patch, verified from source and from the DOM. What's left is that the page frame didn't move when its contents did: the H1 ("Durable review queue"), the subhead ("Intake immutable offline artifacts, submit a human decision..."), and the banner's own phrase ("the queue below is empty by design") all still describe an application this state deliberately no longer renders. A visitor reads a promise of a queue, finds two explanatory cards instead, and has to spend a moment re-confirming nothing is broken — exactly the credibility cost the fix was built to eliminate, now relocated one level up the page.

## What's Working

1. **The example receipt is the strongest idea shipped this cycle.** Reusing the production component instead of mocking one up means the preview cannot drift from reality, and four independent, non-toggleable markers of fictionality (dashed border, permanent badge, disclaimer, self-evidently synthetic values) satisfy the provenance invariant with real margin.
2. **The banner's information order was genuinely inverted for the better** — visitor-facing sentence first, operator instruction demoted, ending on "empty by design — not broken."
3. **The two-column claim/proof pairing earns its layout** — abstract value prop on the left, concrete artifact on the right, at matched height on desktop.

## Priority Issues

**[P1] The page header still describes an application this state doesn't render**
Why it matters: the H1, subhead, and the banner's own "the queue below" phrase are three separate promises of UI that's no longer on the page — the banner's claim is now literally false, since there is no queue below it. A visitor has to spend their first moments re-establishing that nothing is broken, right after the fix's own reassurance was supposed to close that question.
Fix: branch the hero copy on `transport` the same way the body already does — disconnected state gets its own H1/subhead/banner phrasing that doesn't promise a queue; connected state keeps today's copy unchanged.
Suggested command: `/impeccable clarify`

**[P1] A real configuration error erases the fix instructions instead of joining them**
Why it matters: when `connection.configurationError` is set, it renders *in place of* the env-var guidance — so the operator who has a working setup sees the how-to, and the operator who set it up *wrong* (the one who's actually stuck) loses the syntax, the HTTPS requirement, and the no-credentials rule at exactly the moment they need them most.
Fix: render the error above the guidance, not instead of it — the error names the problem, the guidance stays put and shows what correct looks like.
Suggested command: `/impeccable harden`

**[P2] The two outbound links — now the page's entire reason for existing — are its smallest touch targets**
Why it matters: measured at a verified true 390×844, "Self-hosting guide" (104×16) and "Source on GitHub" (98×16) are the only two routes off a page whose entire job is now to route people outward, at roughly a third of a comfortable tap target.
Fix: give both `min-h-[44px]` with real padding, or promote them to bordered secondary buttons — they're the primary action now and are styled like a footnote.
Suggested command: `/impeccable polish`

**[P2] The fictional marking depends entirely on the values staying obviously fake, with no guardrail against a future edit weakening it**
Why it matters: not a current defect — the repeated-character hashes are unmistakable — but the "Example" badge scrolls out of view (541px) before the last proof claims do, so a screenshot of just the claims carries no qualifier, and nothing stops a future contributor from "improving" the fixture with realistic-looking values, silently removing the one safeguard that currently matters most.
Fix: add a persistent visual marker to the card itself (not just the header), and a code comment on `EXAMPLE_RECEIPT_PROOF` stating the repeated-character values are load-bearing and must never be made to look realistic.
Suggested command: `/impeccable harden`

**[P2] Three stacked, partly-duplicated explanations before any content**
Why it matters: a standalone fine-print paragraph near-verbatim repeats the banner's own second paragraph (both state the HTTPS/no-credential/HttpOnly-cookie rule), which makes a real security rule read as boilerplate — the opposite of the intent — and adds to a page that's already 1,883px tall with roughly 430px of trailing empty canvas.
Fix: delete the standalone fine-print paragraph; the banner already carries it where relevant.
Suggested command: `/impeccable distill`

## Persona Red Flags

**Jordan (Confused First-Timer / the primary visitor here)**: reads "Durable review queue," scrolls looking for one, finds two explanation cards instead — recovers because "empty by design, not broken" does real work, but loses the first several seconds to that confusion. Hits operator-only vocabulary (`CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL`, "HttpOnly session cookie") shown unconditionally. No link anywhere on the page to the working public demo — the one thing Jordan could actually go do right now is reachable only by guessing the top nav means that.

**Casey (Distracted Mobile User)**: layout holds up cleanly (zero horizontal overflow at a verified 390px, long hashes wrap correctly) but the page is 2.2 screens tall to say "we're not connected, here's why you'd want to be," and the only two tappable destinations are 16px tall, 16px apart, easy to thumb past without registering as links.

**Riley (Stress Tester)**: probes the receipt for anything real, finds nothing — passes cleanly. Sets a malformed gateway URL, hits the `configurationError` branch, watches the format instructions disappear — correctly files that as a bug. Notes the banner's "queue below" refers to nothing, and that the same security sentence appears twice within 200px.

## Minor Observations

- No `<main>` landmark on the page — screen readers get `header`/`nav`/`section` only, with no primary-content target or skip link; both explainer sections are otherwise properly `aria-labelledby`'d, so this is a one-wrapper-element fix.
- The `Example` badge sits `justify-between` against a two-line eyebrow at narrow widths and reads as slightly detached from the heading it qualifies.
- A code comment on `EXAMPLE_RECEIPT_PROOF` references an "example.invalid issuer" as one of the synthetic markers, but no issuer field exists in the object — harmless, but describes a safeguard that isn't actually there.
- The env var name renders as copyable-looking `<code>` with no copy affordance — the one moment on the page where a small accelerator would pay off.

## Questions to Consider

1. If the disconnected state no longer renders a queue, what is the H1 actually for — would "See what self-hosting adds" be a more honest headline than a promise of UI that isn't present?
2. The example receipt is the most persuasive element on the page — why does it sit below the fold on mobile, behind two paragraphs of explanation, instead of leading?
3. What if the page's primary action were "Go see the public replay" rather than "read about a server you don't run"? Right now both links send an evaluator to GitHub — away from the product, at the exact moment they're most curious about it.
