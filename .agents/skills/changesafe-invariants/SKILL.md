---
name: changesafe-invariants
description: Review a ChangeSafe change against the project's ten safety invariants. Use before merging, when reviewing a contributed PR, or when a change touches policies, the state machine, receipts, the AI layer, the server, or scenario fixtures.
---

# Reviewing against the safety invariants

`AGENTS.md` **states** the ten invariants. This is how to **check** a diff
against them, and which existing test proves each one — so a regression shows
up as a failing assertion rather than as an opinion in review.

Start by scoping: `git diff main...HEAD --stat`. Most changes touch two or
three of the groups below; check those properly rather than all ten shallowly.

## 1. The gate never consults a model

The load-bearing one. Everything else is downstream of it.

```bash
# Must return nothing. A policy importing the AI layer is a design failure,
# not a style issue.
grep -rn "@changesafe/ai" packages/core/src packages/domain-*/src

# Model confidence must not reach a policy. Match the property read, not the
# word — `confidence` alone hits the doc comments that say it is banned.
grep -rn "\.confidence" packages/core/src/policies packages/domain-*/src/policies
```

Risk derivation is core-owned: any BLOCK → CRITICAL, ≥2 WARN → HIGH, 1 WARN →
MEDIUM, else LOW. If a diff computes risk anywhere but `deriveRiskLevel`, or a
domain derives its own, that is the finding.

Policies must stay pure — no clock, no randomness, no I/O. A policy that reads
`Date.now()` makes verdicts unreproducible and receipts unverifiable.

## 2. A BLOCK is final, everywhere

Approval must be impossible at the **domain** layer, not merely in the UI.

- `transition()` throws on `BLOCKED → APPROVE` / `SIMULATION_COMPLETED`, and
  `APPROVE` re-checks findings even from a mislabeled state.
- The server answers 409 and writes nothing to the ledger.
- There is no `--auto-approve` in the CLI and no endpoint that creates one.

```bash
grep -rn "auto.approve\|autoApprove" --include="*.ts" .   # must find only prose saying it will not exist
```

Proven by: `packages/server/tests/decisions.test.ts` → *"what authentication
does not buy"*, and the state-machine tests that attempt the transition
directly rather than checking a disabled button.

**Authentication grants no power over the gate.** If a diff adds a role, a
claim, or a flag that lets *someone* approve a BLOCK, that is the most serious
possible regression in this codebase.

## 3. No execution path

No SSH, NETCONF, RESTCONF, SNMP, gNMI-SET, vendor SDK, shell, `terraform
apply`, or arbitrary outbound HTTP action.

```bash
# Shelling out. Must be clean under src/.
grep -rn "child_process" --include="*.ts" packages/*/src lib/ app/

# Device protocols and apply verbs.
grep -rniE "\b(ssh2?|netconf|restconf|snmp|gnmi)\b|terraform +apply" \
  --include="*.ts" packages/*/src lib/ app/
```

**Two expected hits. Do not "fix" either:**

- The second grep matches `packages/domain-network/src/paths.ts`, which
  *screens for* those verbs — it is the detector that blocks command
  smuggling, so the words are the payload it rejects.
- `child_process` appears under `tests/` and `packages/cli/tests/`, which run
  the built binary. A test harness is not a product path.

Do **not** widen these to `exec(` or `spawn(`: that matches
`RegExp.prototype.exec` and SQLite's `db.exec` all over `signature.ts`,
`oidc.ts`, and `ledger.ts`, and a check that cries wolf stops being read.

A real finding is `src/` code doing the acting rather than the detecting.

## 4. Model output is untrusted until locally validated

Provider structured output is a quality measure, not a control. Acceptance
requires, in order: strict Zod parse → evidence-id check → resource-reference
check. Invented evidence or unknown resources are hard rejections.

If a diff adds a provider, confirm it runs the *same* path — there is no
trusted-provider fast lane. `packages/ai/tests/providers.test.ts` asserts all
providers produce byte-identical accepted output from equivalent responses;
extend it rather than adding a parallel test.

## 5. Untrusted text is never instructions

Alerts, notes, names, values, PR bodies, plan contents. `UNTRUSTED_INSTRUCTION`
flags instruction-like language as **evidence** — it must never be what keeps
the system safe. The test: delete the detector mentally; is the change still
blocked on what it *does*? If not, the scenario or policy set is wrong.

Trusted instructions live in the system prompt; untrusted content travels only
inside `<untrusted_incident_data>`. CI greps the client bundle for the
delimiter to prove the prompt stays server-side.

## 6. Secrets stay server-side

Credentials exist only in server/CLI environment scope — never in client
bundles, receipts, fixtures, logs, or error messages. Provider error bodies can
echo the request, so upstream failures collapse to a status code.

CI job **"Secrets never reach the client bundle"** builds with a per-provider
canary and greps `.next/static`, and additionally fails if a provider endpoint
string appears — that would mean something imported the AI layer into the
browser, putting a credential one refactor from the wire.

If a diff adds a provider, add its canary to that job.

## 7. Simulation is sandboxed and transactional

Mutates deep clones only; patch application is all-or-nothing so no partial
mutation escapes; rollback verified by canonical equality where the domain
supports it. A simulation test that does not assert the input state is
untouched is not testing this.

## 8. Receipts and provenance are honest

- `receiptSha256` covers canonical content minus itself.
- `approver: null` means *no authenticated approver was established* — not a
  claim that nobody decided. A `gate_only` receipt may never name one.
- Authored fixtures declare `model: null`; `captured` requires model and
  timestamp.
- Replay is always labeled and never silently substituted for live analysis.
- A signature is only meaningful against a key obtained out of band; an
  unchecked signature must never read as verified.

## 9. Bundled data is fictional and publishable

Documentation IP ranges only — `192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24`. No real organizations, no third-party branding, no PII. The
scenario harness asserts the address ranges.

## 10. Versioning follows behavior

Any policy behavior change bumps `CORE_POLICY_VERSION` or the domain's version,
and updates receipt tests. A changed verdict with an unchanged `policyVersion`
makes every prior receipt silently un-reproducible.

## Finish

```bash
npm run lint && npm run typecheck && npm run build:cli && npm test && npm run build
```

`build:cli` **before** `test`: the shipped-binary test only runs when the
bundle exists, so running tests first silently skips the proof that the
artifact works outside the workspace.

If a change weakens an existing assertion, that is the finding — not the
weakened test. The rule is to make the invariant precise, not to make the
assertion agree. When a test genuinely encoded a narrower rule than intended,
replace it with a *broader* one and say so explicitly in the commit.
