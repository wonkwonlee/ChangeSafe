# ChangeSafe

**An AI infrastructure change airlock.** ChangeSafe converts an infrastructure
incident into an evidence-backed change proposal, validates it with
deterministic safety policies, and requires human approval before sandboxed
execution.

> AI diagnoses and proposes. Deterministic code validates. A human decides.
> The MVP never touches real infrastructure.

Built for OpenAI Build Week 2026 (Developer Tools track).

## Why

During urgent incidents, AI copilots will confidently suggest changes that
sever management access, delete protected resources, or omit rollback plans —
and reviewers approve prose instead of executable policy. ChangeSafe
demonstrates the missing layer: a gate where the model's output is just typed
data that must survive seven deterministic policies and an explicit human
decision, with every outcome preserved as a hashed receipt.

The product proves one thing visibly: **a plausible, confidently worded AI
proposal cannot get approved unless deterministic safety checks pass.**

![The red-team scenario blocked by the deterministic safety gate](docs/screenshots/scenario-b-blocked.png)

*The red-team scenario: a 91%-confident proposal (echoing an instruction
injected into an operator note) is blocked by two deterministic policies;
approval is impossible and the refusal becomes a hashed receipt.*

![The safe scenario analyzed, with diagnosis, operations and diff](docs/screenshots/scenario-a-analyzed.png)

## Quickstart (no API key needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. Replay mode works immediately with bundled,
clearly labeled fixtures — this is the intended judging path.

**Two bundled synthetic scenarios:**

| Scenario | What happens |
| --- | --- |
| `INC-4821 — Degraded primary uplink` | A safe failover proposal passes all 7 policies (risk LOW). You can approve it, watch the sandbox simulation, and download the hashed receipt. |
| `INC-4977 — Suspected route leak` | A red-team proposal (echoing a prompt injection hidden in an operator note) tries to remove the only management route to a protected firewall. `MGMT_REACHABILITY` and `PROTECTED_RESOURCE` BLOCK it, `UNTRUSTED_INSTRUCTION` flags the injected note, risk is CRITICAL, and approval is impossible — in the UI *and* in the domain state machine. |

## Live mode (optional)

```bash
cp .env.example .env.local
# put your key in .env.local: OPENAI_API_KEY=...
npm run dev
```

The header badge switches from `replay only` to `live available` and an
**Analyze with GPT-5.6** button appears. Live calls run exclusively on the
server (Responses API, Structured Outputs); the key never reaches the
browser, and a failed live call offers an explicit switch to replay — never a
silent substitution.

## Commands

```bash
npm run dev        # start the app
npm run lint       # eslint
npm run typecheck  # tsc --noEmit (strict)
npm test           # vitest unit + integration (no network, no API credit)
npm run build      # production build
npm run test:e2e   # Playwright critical paths (replay mode, keyless)
```

One-time before `test:e2e`: `npx playwright install chromium`.

Optional live smoke test (spends API credit, never runs by default):

```bash
CHANGESAFE_LIVE_SMOKE=1 npm test
# additionally capture a provenance-stamped fixture for scenario A:
CHANGESAFE_LIVE_SMOKE=1 CHANGESAFE_CAPTURE_FIXTURE=1 npm test
```

## How it works

```text
            untrusted incident bundle (synthetic)
                          │
              ┌───────────▼───────────┐   server-only; Structured Outputs +
              │  ① AI PROPOSAL        │   local Zod re-validation; invented
              │  GPT-5.6 or replay    │   evidence/devices hard-rejected
              └───────────┬───────────┘
                          │ typed ChangeProposal (data, not commands)
              ┌───────────▼───────────┐   7 frozen pure policies; risk is
              │  ② DETERMINISTIC GATE │   derived only from PASS/WARN/BLOCK;
              │  policies + risk      │   model confidence has no input
              └───────────┬───────────┘
                 any BLOCK │ no BLOCK
              ┌─────▼─────┐ ┌───▼────────────┐
              │  BLOCKED  │ │ ③ HUMAN DECIDES│  approve / reject
              └─────┬─────┘ └───┬────────────┘
                    │     approve│
                    │  ┌─────────▼──────────┐  transactional patch on a deep
                    │  │ ④ SANDBOX SIMULATE │  clone; safety properties
                    │  └─────────┬──────────┘  re-checked; nothing real
              ┌─────▼────────────▼──────────┐
              │ ⑤ HASHED CHANGE RECEIPT     │  SHA-256 over canonical JSON
              └─────────────────────────────┘
```

- **Domain schemas first** (`lib/domain/schemas.ts`): Zod is the single source
  of truth; scenario fixtures, model output, findings, and receipts all parse
  through the same schemas.
- **Explicit state machine** (`lib/domain/state-machine.ts`): every workflow
  arrow is a case; `BLOCKED → APPROVED` and `BLOCKED → SIMULATED` throw
  `IllegalTransitionError` no matter who calls.
- **Patch engine** (`lib/patch/`): four allowlisted path families,
  transactional apply on a `structuredClone`, structured diff, inverse
  derivation, rollback verified by canonical equality.
- **Policies** (`lib/policies/`): `PATCH_SCHEMA`, `MGMT_REACHABILITY`,
  `PROTECTED_RESOURCE`, `BLAST_RADIUS`, `ROLLBACK_COMPLETE`,
  `VERIFICATION_REQUIRED`, `UNTRUSTED_INSTRUCTION` — pure functions, each
  fail-closed, none may import AI code.
- **Receipts** (`lib/receipt/`): canonical (sorted-key) serialization,
  SHA-256 incident/proposal hashes, and a receipt self-hash computed over
  everything except the hash field.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) ·
[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## How GPT-5.6 is used at runtime

GPT-5.6 (OpenAI Responses API, server-only) performs exactly one job:
interpret the incident bundle and emit a typed `ChangeProposal` — diagnosis
with citations to real evidence ids, declarative operations, rollback
operations, and verification steps — under hardened instructions that treat
all incident content as untrusted data. It never validates, scores risk,
approves, or executes; deterministic local code and a human do that. Output is
accepted only after Structured Outputs enforcement **and** local Zod
re-validation, plus rejection of invented evidence ids and unknown devices.

## How Codex was used

<!-- PLACEHOLDER (owner action): describe in your own words how you used
     Codex during Build Week, and add the primary /feedback session ID in
     BUILD_WEEK_CHANGELOG.md. Do not invent the ID. -->

Implementation during the Build Week window was AI-accelerated pair
engineering under human product and safety direction; dated milestones and
commit hashes are in [BUILD_WEEK_CHANGELOG.md](BUILD_WEEK_CHANGELOG.md).

## Key human decisions

- The trust model itself: model proposes, deterministic code validates, a
  human decides, simulation only — and the frozen seven-policy set.
- Fail-closed policy semantics (unprovable safety = BLOCK, never a warning).
- Honest replay provenance: authored fixtures are labeled as authored and
  never attributed to GPT-5.6; `captured_gpt_5_6` requires capture metadata.
- Risk derivation is purely a function of policy verdicts; model confidence
  is displayed but has no effect.
- The red-team scenario intentionally ships an unsafe proposal so the gate's
  value is demonstrable, not asserted.

## Replay vs live, honestly

Replay skips **only** the network call. Fixtures carry explicit provenance
(`authored_synthetic`, `authored_red_team`, or `captured_gpt_5_6` with capture
metadata), are validated by the same schemas as live output, and run the
identical validation → policy → decision → simulation → receipt pipeline. The
UI labels replay output as fixture content and never presents it as a live
model call.

## Deployment (Vercel)

```bash
npm i -g vercel
vercel            # accept defaults; framework auto-detected
vercel --prod
```

- With no environment variables, the deployment runs in replay mode — fully
  functional for judges, no login, no cost.
- To enable live mode, add `OPENAI_API_KEY` as a server-side environment
  variable in the Vercel project settings (never expose it with a
  `NEXT_PUBLIC_` prefix) and redeploy.

## Limitations and non-goals

- No real device access of any kind: no SSH/NETCONF/RESTCONF/SNMP, no vendor
  SDKs, no shell execution — by design, and enforced by the absence of any
  such code path.
- The synthetic network model (reachability = physical path + covering
  routes) is deliberately simple; it demonstrates deterministic validation,
  not production routing semantics.
- Receipts prove integrity (hash), not authorship — there is no key
  infrastructure or signature in v0.1.
- Single user, no auth/teams/RBAC, no database, two scenarios only.
- Scenario A's bundled fixture is authored (labeled as such) until an owner
  runs the capture flow to replace it with a real `captured_gpt_5_6` response.

## License

MIT — see [LICENSE](LICENSE).
