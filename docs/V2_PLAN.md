# ChangeSafe v2 Plan

Synthesized 2026-07-19 from three independent reviews (product/YC, technical
architecture, adversarial judge) of the complete v0.1 repository. Planning
document only — no code changes accompany it. The trust model is
non-negotiable in every item below: **AI proposes, deterministic code
validates, a human decides, and ChangeSafe never executes against real
infrastructure.**

## 1. Where v0.1 stands (verified)

- Full gate green from clean install: 130 unit/integration tests, 3 E2E,
  lint/typecheck/build clean. No secrets tracked; no execution surface.
- Judge-lens rubric (repo-only): technological implementation **7/10**,
  product design coherence **7/10**, credible impact **5/10**, novelty
  **8/10**. The engineering and the honesty story are strengths; impact
  evidence and demonstrated AI substance are the weaknesses.
- The pure core is genuinely v2-grade and relocates server-side verbatim:
  `lib/domain/` (schemas, state machine), `lib/policies/`, `lib/patch/`,
  `lib/receipt/`, `lib/ai/` boundary. Demo scaffolding to replace in v2: the
  client-side decision path (`components/useWorkflow.ts` runs
  policies/simulation/receipts in the browser), the simplified reachability
  BFS, two hardcoded scenarios, unsigned client-generated receipts, no
  persistence, no identity.

## 2. Pre-deadline checklist (before Jul 21, 5:00 PM PDT)

Ranked by (judging impact × fixability). Items 1–3 are required submission
materials; 5–7 are safe polish; item 4 is high-value but requires
re-verification (see its caveat). No risky rebuilds in this window.

1. **Codex evidence (owner)** — replace `TODO-OWNER-INSERT` in
   `BUILD_WEEK_CHANGELOG.md` with the real Codex `/feedback` session ID and
   write the honest Codex-usage paragraph there and in `README.md` ("How
   Codex was used"). A required field left as a placeholder reads as
   incomplete.
2. **Demo video (owner)** — record from `docs/DEMO_SCRIPT.md` (unsafe-first,
   ≤2:30; script is ready and deterministic). Say "authored replay fixture"
   out loud where the script marks it. Host publicly and link it.
3. **Public deploy + repo (owner)** — `vercel --prod` (keyless replay is
   fully functional), verify both scenarios on the public URL, push the
   repository public, attach both links.
4. **Capture a real GPT-5.6 fixture (owner, if a key is available)** — run
   `CHANGESAFE_LIVE_SMOKE=1 CHANGESAFE_CAPTURE_FIXTURE=1 npm test`, review
   the capture, promote it to scenario A's `replay-fixture.json` with
   `captured_gpt_5_6` provenance. Converts "GPT-5.6 integrated" from claim to
   evidence and retires the hardest judge question. **Caveat: this is not
   drop-in polish** — promotion also requires updating scenario A's e2e
   assertions (`tests/e2e/airlock.spec.ts` expects the authored label,
   `authored_synthetic` provenance, and `model: null`) and the demo-script
   label, then re-running the full gate; the real model's proposal may also
   change scenario A's demonstrated "7 PASS / risk LOW" outcome. If that
   cannot be re-verified before the deadline, keep the authored fixture and
   only tighten wording so nothing implies the keyless demo exercises the
   model.
5. **Fix the dead reference** — scenario A's fixture note cites
   `scripts/capture-fixture.ts`, which does not exist (the real flow is the
   env-gated live-smoke test). One-line correction in
   `scenarios/scenario-a-failover/replay-fixture.json`.
6. **Pin Node** — add an `engines` field (and `.nvmrc`) so a judge on old
   Node gets guidance instead of a failed install (Next 16/React 19 need
   modern Node).
7. **Tone down one phrase** — "enterprise operations console" oversells a
   single-user demo; "operations-console-grade UI" keeps the design claim
   without the enterprise claim.

## 3. Positioning (v2 narrative)

- **One-liner**: "ChangeSafe is the airlock every AI SRE agent needs before
  it touches production — the model proposes a change, deterministic policy
  decides if it's allowed, a human approves, and every decision is a hashed
  receipt."
- **Wedge**: incident-time network remediation review. **Frame**: the
  control/approval plane for agentic infrastructure actions (why-now: agents
  are being handed tool access; prompt injection is unsolved; the demo makes
  it visceral).
- **User vs buyer**: on-call SRE/network engineers use it; Head of
  Platform/VP Eng buys it, with security/compliance as co-buyer via the
  receipt/audit story.
- **Novelty sentence to lead with**: "the model is structurally prevented
  from being trusted — its 91% confidence buys nothing."
- **Metrics v2 must instrument**: unsafe-change catch rate (high-confidence
  proposals BLOCKed), time-to-safe-decision, in-path coverage
  (% changes routed through the airlock; approve/reject/override rates).

## 4. v2 product roadmap

**Next (v2 core, ~4–8 weeks)** — each item converts demo → product while
keeping ingestion strictly read-only and execution nonexistent:

1. **Bring-your-own-scenario** — paste/upload a sanitized incident + state
   snapshot and run the airlock on it. The moment it's *their* infra, it's a
   product. (Depends on tech milestones 1–2.)
2. **Read-only integrations, one of each** — alert ingress (Prometheus
   Alertmanager + generic JSON webhook first; PagerDuty/Opsgenie Events v2
   next) and state ingress (one documented neutral snapshot schema a
   collector emits; then read-only NAPALM/gNMI pullers). Kills the
   synthetic-data objection.
3. **Policy packs per environment** — per-tenant thresholds/allowlists
   (blast-radius limit, protected-resource lists, change windows) as
   Zod-validated config over compiled policy predicates. Starts the
   policy-library moat.
4. **Team workflow + durable audit trail** — proposer/approver separation,
   persisted searchable receipts, change history. Receipts become compliance
   artifacts (change audit/SOC2) — unlocks the budget-holding buyer.
5. **Surfaces where incidents live** — Slack (then PagerDuty) app posting
   proposal + gate verdict with inline approve/reject. Nobody opens a new
   console mid-incident.

**Later** — gated apply *handoff* (an approved, receipted change handed to
the team's existing execution system — a change PR, their Terraform apply,
their vendor automation; ChangeSafe itself still never touches devices);
domain expansion (cloud/IaC, k8s, IAM — same airlock, new state+policy
models); signed receipts as tamper-evident records; a public red-team fixture
corpus / benchmark for AI-infra-agent safety (own the benchmark = moat +
marketing).

**Pricing hypothesis**: land at team tier (~$500–2k/mo per environment or per
approver seat) on the platform/SRE budget; expand to org-wide
governance/compliance tier (~$50–150k/yr) gated on audit trail +
integrations. ROI story: one prevented outage.

## 5. v2 technical migration (sequenced; replay demo never breaks)

| # | Milestone | Effort | Notes |
|---|-----------|--------|-------|
| 1 | Lift the decision path server-side (policies → classify → decide → simulate → receipt behind authenticated routes; pure libs relocate verbatim, only call sites move) | M | The single biggest demo→product gap; client keeps optimistic mirror |
| 2 | Persistence: Postgres, append-only `incidents` / `analyses` / `decisions` / `audit_log`; store canonical bytes so hashes verify | S | Thin `lib/store/`; domain stays pure |
| 3 | AuthN/Z: OIDC/SSO; approver identity into receipts; optional proposer≠approver | M | 2–3 roles max — approver attestation, not an IAM platform |
| 4 | Receipt signing (server keypair, hash retained) | S | Closes "integrity, not authorship" |
| 5 | Read-only ingestion: alert webhooks + neutral snapshot importer; `IncidentBundle` superRefine is the validation gate; vendor shapes never cross the adapter | L | Parallelizable behind the adapter boundary |
| 6 | PolicyPack config (typed params over compiled predicates; default pack == today's constants) | M | Explicitly **not** a DSL |
| 7 | Simulation fidelity ladder: LPM + admin distance → next-hop resolution → ACL/firewall semantics → VRF/ECMP; property-based tests; version the sim engine and pin `POLICY_VERSION` to it | L | Policies and simulation share one reachability engine — keep it that way |
| 8 | Model eval harness: captured-fixture corpus, capture pipeline on prompt changes, regression gate measuring "did findings/risk/decision change" | M | The deterministic gate makes model-change regressions precisely measurable |

Order rationale: 1–4 harden the trust/audit core before any multi-user
exposure; 5 unlocks real-world value; 6–8 deepen the moat.

## 6. Risk register (top items)

- **Vendor-format sprawl** → one neutral canonical snapshot schema is all
  policies ever see; vendors map at the edge; schema gate rejects bad maps.
- **Policy soundness vs richer simulation** → shared reachability engine,
  red-team corpus that must always BLOCK, `POLICY_VERSION` pinned to the
  sim-engine version.
- **Client/server trust regression during the lift** → server is sole
  authority for APPROVE/REJECT/receipts; add API-level illegal-approval
  contract tests mirroring today's domain-level ones.
- **State-machine growth** → identity/expiry/multi-approver enter as guards
  around events, never new phases without illegal-transition tests.
- **Prompt injection via real ingested data** → already survives by design:
  safety never depends on the model resisting; the deterministic gate carries
  unchanged into real-data ingestion. Keep `UNTRUSTED_INSTRUCTION` as
  evidence-only WARN.
- **Live-path risk** → the Responses API call has never executed against the
  real endpoint; first key-in-hand action is the smoke test.

## 7. Do-not-build (v2 discipline)

- Any device write path (SSH/NETCONF/RESTCONF/gNMI-SET/SNMP-set/CLI) — the
  absence of an execution surface *is* the product.
- Customer-authored policy DSL / embedded Rego — an interpreter reintroduces
  unsoundness; parameterized compiled predicates only.
- Model influence on approval, risk, or execution; auto-approval fast-paths
  even at LOW risk.
- Enterprise IAM/teams/orgs/billing platform before the ingestion + audit
  core is proven.
- Generic remediation chat / RAG — dilutes the airlock into a copilot.

## 8. YC objections and honest answers (prep sheet)

- *"Where do real incidents/state come from, and how does an approved change
  get applied?"* → v2 milestones 5 (read-only ingestion) and the Later-stage
  apply *handoff* to the customer's own execution system; ChangeSafe never
  gains device access.
- *"Isn't this OPA + a nice UI?"* → incident-time (not deploy-time),
  AI-adversarial by construction (injection-independent gate), state
  simulation with verified rollback, and receipts as the audit
  system-of-record.
- *"What's the moat?"* → accumulating policy-pack library, in-path
  integrations, receipts as compliance record, and the red-team
  corpus/benchmark. Honest today: none yet — v2 builds them.
- *"In the keyless demo, what did GPT-5.6 actually do?"* → nothing; fixtures
  are authored and labeled as such. The thesis is precisely that the gate
  doesn't care who authored the proposal. Pre-deadline item 4 (real capture)
  retires most of this question.

## 9. Open decisions for the owner

1. Spend on a live GPT-5.6 capture before the deadline? (Recommended if a
   key exists — highest proof-per-effort.)
2. v2 wedge confirmation: stay network-first, or lead with the broader
   "agentic action approval plane" framing in YC materials while shipping
   network-first? (Recommendation: build network-first, pitch the plane.)
3. Postgres host / deployment target for v2 (managed PG on Vercel/Neon vs
   fly.io etc.) — affects milestone 2 only.
4. Design-partner outreach: identify 1–2 infra teams for the impact-evidence
   gap (the 5/10) — the single most valuable non-code v2 investment.
