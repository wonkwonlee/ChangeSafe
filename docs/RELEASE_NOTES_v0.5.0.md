# ChangeSafe v0.5.0

A trust-model fix in `@changesafe/core`, a new Terraform policy that replaces
a prose-only skip with a real one, `changesafe eval` gaining Kubernetes
support, and two security-relevant fixes to the Kubernetes analysis prompt.

**Policy behavior changed.** `CORE_POLICY_VERSION` moves to `core-v0.2.0` and
`TERRAFORM_POLICY_VERSION` moves to `terraform-v0.2.0`. A v0.5.0 receipt is
not directly comparable to a v0.4.x one — that is the point of the version
existing, not an oversight.

## Universal-policy skip legitimacy, enforced in core

A domain adapter's `skippedUniversalPolicies` could previously name any of
the five universal policies, not just the two whose shape assumes a
model-authored proposal or an in-place patch (`ROLLBACK_COMPLETE`,
`VERIFICATION_REQUIRED`). The only check against this lived in the app's own
runtime registration (`features/domains/runtime.ts`), not in published core —
so a hand-written adapter, or `changesafe gate` run directly against one,
got no enforcement at all. A probe adapter that skipped all five universal
policies passed `evaluatePolicies` cleanly with zero findings and `LOW` risk,
despite the proposal carrying an injection attempt, invented evidence, no
rollback, and no verification.

`replacedBy` was also a bare string, so nothing verified a skip's claimed
replacement existed. Terraform's `VERIFICATION_REQUIRED` skip named `"the
pull request review"` — prose, not a policy.

Fixed:

- `evaluatePolicies` and `policyOrder` both validate every skip before doing
  anything else, and throw for an illegitimate `policyId`, a duplicate skip,
  or a replacement that names a policy the adapter does not declare (or that
  collides with a universal policy id, which `policyOrder`'s id filter could
  not otherwise distinguish from the skip itself). Only
  `ROLLBACK_COMPLETE`/`VERIFICATION_REQUIRED` may ever be skipped —
  `PATCH_SCHEMA`, `BLAST_RADIUS`, and `UNTRUSTED_INSTRUCTION` are structurally
  answerable by every domain and no adapter may skip them.
- `SkipReplacement` is a typed shape (`{ kind: "domain-policy", policyId }`)
  instead of a string. A replacement that named a non-mechanical process
  rather than a real policy would have produced no finding of its own — the
  gate would pass with a genuine verdict gap rather than merely an
  honestly-labeled one — so that option does not exist at all.
- Every receipt now carries `policyCoverage`: the exact ordered policy ids
  that ran, plus what was skipped and why. A verifier reads this from the
  signed payload instead of fetching and trusting the adapter's source to
  interpret an absent policy id. The field is optional on
  `ChangeReceiptSchema` so a receipt issued before it existed (v0.4.1 and
  earlier) still parses for hash and signature verification —
  `createReceipt` always sets it going forward, and `canonicalize` drops an
  `undefined` property, so a legacy receipt's hash is unaffected.

## Terraform gains `PLAN_CONTEXT_REQUIRED`

Terraform's proposal is derived mechanically from the plan with no model
involved, so it can never declare its own precondition or postcheck steps —
that is the honest reason it skips `VERIFICATION_REQUIRED`. What replaces it
used to be prose. It is now a real policy: `PLAN_CONTEXT_REQUIRED` warns when
a destructive change carries zero PR or commit context, because the pull
request review this domain relies on for verification needs something to
review. A plan that destroys nothing, or that carries any context entry,
passes.

## `changesafe eval` measures Kubernetes too

The benchmark previously imported `networkAnalysisPrompt` and `networkDomain`
only, so it measured one domain while the corpus spans three. Kubernetes now
has its own hardened prompt (`packages/ai/src/prompts/kubernetes.ts`) and is
registered in `ANALYSIS_DOMAINS`; `eval --domain kubernetes` resolves it
instead of the hardcoded network path. Terraform stays out by design — its
plan already is the proposal, so there is nothing for a model to propose.
Report schema moves to version 3, recording `corpus.domain`, so a report is
only ever compared against another from the same domain.

## Two fixes in the same change

Landed as part of getting Kubernetes eval support production-honest, not
found independently:

- **Kubernetes eval input is normalized.** The strict, already-normalized
  `KubernetesSnapshotSchema` was being parsed directly against raw,
  collector-shaped scenario fixtures — every bundled Kubernetes scenario
  failed before ever reaching the provider. `eval`'s Kubernetes domain now
  tries the strict parse first and falls back to `normalizeSnapshot`, the
  same boundary `changesafe gate` already used.
- **Pod-label and Service-selector values stay inside the untrusted
  block.** The Kubernetes prompt's trusted preamble — the section the model
  is told to trust, ahead of `<untrusted_snapshot_data>` — was echoing
  `podLabels` and `selector` values into it. Those are `Record<string,
  string>` with no charset restriction beyond length, so an instruction-like
  value there bypassed the untrusted-content boundary the system prompt
  describes. They are no longer copied into the preamble; the full snapshot
  already carries them inside the untrusted block.
- **Rollback references are validated too.** The Kubernetes prompt's local
  cross-check validated a forward `replace` against the snapshot but never a
  rollback `replace`, and accepted any rollback `remove` regardless of
  whether it undid something the proposal actually added. A model response
  with an ungrounded rollback reference was counted `accepted` by the
  benchmark before the gate's `PATCH_SCHEMA` policy caught it downstream —
  inflating the grounded-output metric for a proposal that was always going
  to be blocked.
- **Prompt/adapter pairing is typed.** The analysis domain registry paired
  each prompt with its adapter through two independent `as unknown as never`
  casts, so nothing prevented registering, say, the Kubernetes prompt against
  the network adapter. A single generic function now binds both under one
  type parameter, so a mismatched pairing fails to typecheck.

## Known limits

- Terraform still cannot catch command smuggling: it is an external-diff
  domain with no simulator, and no Terraform policy inspects planned
  attribute values for command payloads. Tracked, not papered over with a
  scenario the gate would not actually refuse.
- `K8S_SERVICE_SELECTOR` still only re-checks Services that existed before a
  change; whether it should also check newly created Services is an open
  decision, not yet made.
