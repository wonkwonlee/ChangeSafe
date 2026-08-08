---
target: "https://change-safe.vercel.app/workbench/self-hosted"
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-07T20-06-12Z
slug: change-safe-vercel-app-workbench-self-hosted
---
Method: dual-agent (A: critique-sh-A · B: critique-sh-B)

> **Scope note**: this route is not a working app on the public deployment — `CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL` is unset, so it renders the full three-pane self-hosted shell (intake / detail / queue) with every control present but disabled. There is real surface to review (layout, copy, empty states, disabled-state semantics), but almost no reviewable interaction. Both agents scored and reported against what the page actually offers rather than padding findings.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Accurately says it's unconfigured, but never distinguishes "this public demo can never connect" from "you forgot an env var" |
| 2 | Match System / Real World | 2 | "Durable," "owner-scoped," "intake" are internal vocabulary leaked to the reader with no definition |
| 3 | User Control and Freedom | 3 | Nothing traps the user, lateral nav works cleanly — but there is no *forward* exit at all |
| 4 | Consistency and Standards | 3 | Tight visual match with sibling workbenches; one real break — this page doesn't pass `showSources` to the shared nav, so it silently loses a nav item its siblings all have |
| 5 | Error Prevention | 3 | Genuinely strong: controls are disabled rather than allowed to fail, and the button guard is re-checked in application logic, not just the disabled attribute — UI and logic agree |
| 6 | Recognition Rather Than Recall | 2 | A 47-character env var name must be transcribed by eye from inline prose into a terminal — no `<code>` block, no copy button |
| 7 | Flexibility and Efficiency | 1 | One rigid path, no keyboard affordances, and — unlike its three sibling workbenches — no `?scenario=` deep-link support at all |
| 8 | Aesthetic and Minimalist Design | 2 | Full three-pane app chrome renders for a state with no content; confirmed by the detector's `nested-cards` hit on the "No authenticated reviews" empty state itself |
| 9 | Error Recovery | 2 | Names the problem precisely in plain language, but the fix is a bare variable name with no link, no example, no indication where it goes |
| 10 | Help and Documentation | 0 | Zero outbound links anywhere on the page — no docs, no README, no GitHub. The full focusable set is 4 lateral nav links, 1 select, 2 disabled buttons. |
| **Total** | | **20/40** | **Acceptable, bottom edge — significant improvements needed** |

No heuristic n/a — this is a real (if inert) Operate task flow.

## Design Specificity Verdict

**LLM assessment**: Grounded in the product almost to a fault — in its words. "No infrastructure action exists here. ChangeSafe analyzes, gates, records, and stops" is a load-bearing product thesis given its own permanent, titled section with the same visual weight as receipt proof — a genuine design achievement most products would bury in a footer. But the visual chrome is category-interchangeable (dark slate, hairline borders, amber warning strip — any dev tool from the last four years), and the larger failure is *situational*: the disconnected-state message is written for the operator who'd set an environment variable, but served on a public URL where nearly every reader is an evaluator who will never do that. The page is specific to the product and generic to its actual audience.

**Deterministic scan**: 9 findings across 6 rules, verified with zero false positives (every finding's ancestor chain checked against `[class*="impeccable"]`, plus a before/after overlay-injection count comparison for page-wide rules like `em-dash-overuse`, which stayed at exactly 9 both times — confirming the count is real page content, not overlay pollution). `em-dash-overuse` itself is flagged as noise on this page — the dashes are load-bearing scenario-id separators ("INC-4821 — Degraded primary uplink"), not prose affectation. `nested-cards` ×2 and the flat `overused-font` (100% Geist) corroborate A's observation that a full three-pane app shell renders around content that barely exists.

**Browser evidence**: Contrast is comfortably above AA everywhere measured (h1 16.0:1, amber banner 7.7:1, fine print down to 5.6:1 at 12px — deliberately strong work, since most dark themes fail exactly at that tier), validated against known-good/known-bad control pairs first. All 7 interactive elements fail the 44×44 touch-target guideline at mobile width, worst being the 250×24 wordmark link. Both disabled buttons carry no `title`/`aria-describedby`/`aria-disabled`, so a screen-reader user landing on them gets no reason why they're inert — while the artifact `<select>` is left fully enabled with 16 selectable scenarios that can never be submitted, an odd and confusing pairing.

## Overall Impression

This is the page that should prove ChangeSafe is more than a replay demo — OIDC approver identity, server-recomputed findings, signed receipts, the actual decision-authority path — and it converts that intent into a dead end. The execution-boundary section is a real design achievement, and the disabled-state logic is honestly and defensively built. But the disconnected-state banner reads as a broken deploy rather than a deliberate public state (it borrows the same amber used for genuine policy WARN findings elsewhere), buries that explanation below two paragraphs of deployment security fine print meant for an operator, and then offers the reader precisely zero links anywhere on the page. The single biggest opportunity: this is a documentation gap wearing a UI costume — the fix isn't more interface, it's somewhere for the reader's intent to go.

## What's Working

1. **The execution-boundary section is the clearest expression of the product's thesis anywhere in the UI.** A permanent, titled section whose entire content is "No infrastructure action exists here" — given the same visual weight as receipt proof, not buried in a footer.
2. **Disabled states are honest and defensively correct.** Selecting an unsupported example surfaces a specific explanation rather than silently no-op-ing, and the guard is re-checked in application logic (`createReview`), not just the disabled attribute — UI and logic genuinely agree.
3. **Contrast work is deliberately strong**, clearing AA even at the 12px fine-print tier where most dark themes fail — corroborated independently by both assessments' measurements.

## Priority Issues

**[P0] The page has zero outbound links — a dead end for its entire public audience**
Why it matters: this is the highest-intent page in the product for anyone evaluating adoption, and the full focusable set is 4 lateral nav links, 1 select, and 2 disabled buttons — nothing leaves the page forward, no docs, no repo, no self-hosting guide.
Fix: add a primary link to self-hosting docs directly inside the disconnected banner and a secondary link to the repo; pass `showSources` for consistency with sibling workbenches. If self-hosting docs don't exist yet, that's the actual blocker.
Suggested command: `/impeccable document`

**[P1] The disconnected-state message is written for the operator, but served to the evaluator**
Why it matters: "Set `CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL`..." is correct and useful — for someone who controls a deployment, which is essentially never the public reader. To everyone else it reads as a leaked internal error, undermining trust in a product whose pitch is deterministic reliability.
Fix: split the message by audience — lead with "this workbench connects to a self-hosted server you run; the public deployment has none, so the queue is empty by design," then de-emphasize the operator instruction with the variable in a `<code>` block and a copy button.
Suggested command: `/impeccable clarify`

**[P1] Visual hierarchy buries the only thing the reader needs**
Why it matters: at 390px, the reader consumes ~300px of deployment security fine print (HTTPS constraints, HttpOnly cookies) before reaching the banner that explains why nothing on the page works — deployment concerns answering question five before question one for someone who hasn't decided to deploy anything.
Fix: promote the state message directly under the h1; demote the gateway-URL security note into the operator-facing detail where it's actually relevant.
Suggested command: `/impeccable layout`

**[P2] The full three-pane app renders for a state with no content**
Why it matters: the reader scrolls past an intake panel they can't submit, an empty detail pane, and a queue that can never fill — three separate empty states standing in for one sentence, corroborated by the detector's nested-card hit on the empty-queue markup itself.
Fix: when disconnected, render a purposeful explainer instead of a disabled shell — what self-hosting adds, a static annotated preview of a resolved review (signed receipt, ledger inclusion, approver identity), and the path to get there.
Suggested command: `/impeccable shape`

**[P2] Touch targets fail throughout, and a 15-option flat select ignores its own grouping**
Why it matters: every interactive element measured is under 44×44 (worst: the 250×24 wordmark), and the artifact select holds 15 flat options with no `<optgroup>` despite each label already carrying a domain prefix that could group them — exceeding the working-memory guideline (≤4) by nearly 4×.
Fix: raise interactive min-height to 44px at mobile breakpoints; wrap select options in `<optgroup>`s keyed on the domain id the data already carries.
Suggested command: `/impeccable harden`

## Persona Red Flags

**Jordan (Confused First-Timer)** — most affected, since this page has to sell self-hosting to someone who doesn't know what it means: four pieces of unexplained jargon before any control ("durable," "owner-scoped," "intake"); the banner instructs Jordan to set an environment variable when Jordan has no deployment; zero links out, so Jordan abandons at the banner with no idea whether the product is broken or they are.

**Alex (Impatient Power User, actually evaluating self-hosting)**: wants to see the receipt-proof/signed-decision flow in 60 seconds, gets a greyed button and no demo mode; unlike every sibling workbench, this route accepts no `?scenario=` deep link, so Alex can't URL-hack a preview; both disabled buttons drop out of tab order entirely, so keyboard navigation goes straight from "Kubernetes" to the select and off the page.

**Sam (Accessibility-Dependent)**: genuinely well-served on landmarks and labeling (`aria-current`, labeled `<aside>`s, a real `<label for>` on the select, AA contrast throughout including 12px text) — but the disabled primary button has no `aria-describedby` pointing at the banner explaining why it's disabled, and because it's `disabled` Sam can't even focus it to discover the relationship; three static content blocks are marked `role="status"` despite never changing, diluting the signal for messages that actually would be dynamic.

## Minor Observations

- The h1 reads "Durable review queue" while the queue panel's own heading reads "Reviews" — two names for the same object, 500px apart.
- Disabled controls composite to as low as 2.67:1, which WCAG exempts — but with *every* control on the page disabled, the entire interactive layer reads as ghosted, compounding the "broken deploy" impression.
- The lede states "this client stores no token and never executes infrastructure" — a strong, specific trust claim sitting in a paragraph above the amber banner that almost no one will read that far to reach.
- The nav wraps to three rows at 390px, with the active "Authenticated self-hosted" pill alone on the third row of a four-item nav.

## Questions to Consider

1. Should this route be an app at all on the public deployment? The disabled three-pane shell is the worst of both worlds — it doesn't work and it doesn't explain. What would a page whose only job is "here's what self-hosting gives you, here's how to run it" look like instead?
2. Why does the page that proves ChangeSafe is real have no link to how to get it? Every other surface in this product is meticulous about provenance and verifiability; this one asks the reader to take a deployment action and gives them nowhere to go.
3. What if the disconnected state showed a frozen, annotated review instead of an empty one — a static "this is what a resolved review looks like" using the receipt renderer you already have, turning the emotional low point into the page's peak at zero live-server cost?
