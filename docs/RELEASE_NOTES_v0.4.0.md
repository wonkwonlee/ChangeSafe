# ChangeSafe v0.4.0

This is the first published release of the multi-domain Change Review
Workbench, plus a corpus that grew from nine Network scenarios to 26 across
three domains. Policy behavior did not change: `CORE_POLICY_VERSION`,
`NETWORK_POLICY_VERSION`, and `TERRAFORM_POLICY_VERSION` all stay put, so a
v0.4.0 receipt and a v0.3.1 receipt remain directly comparable.

## The workbench is multi-domain

`/` is the Network public replay. Terraform lives at `/workbench/terraform`,
Kubernetes at `/workbench/kubernetes`, and the optional authenticated client
at `/workbench/self-hosted`. Domains register against an app-local
runtime/presentation registry and a domain-neutral review controller, so the
shell does not know what a network is.

The authority split is enforced in domain and server logic rather than in the
UI:

- **Public replay** evaluates and displays. It creates no decision, no
  simulation record, no durable review, and no receipt.
- **The self-hosted API** carries OIDC approver identity, recomputes findings
  server-side, signs receipts, and appends to the ledger before responding.

`changesafe serve` now wires the durable review queue, so a self-hosted
deployment persists reviews rather than holding them in memory.

**Breaking for app deployments:** the exact `/workbench` route and
`/api/analyze` are retired and return 404. Use the domain subroutes and the
versioned replay API instead. No published package API was renamed.

## Corpus

26 scenarios, 12 adversarial, across network, Terraform, and Kubernetes —
each with an `expectations.json` that CI verifies against the real engine.
`docs/SCENARIOS.md` is generated from the corpus and CI fails if it drifts.

New in this release, `scenario-z-orphaned-canary-service` is Kubernetes' first
created-resource change and its first silent safety regression:
`K8S_SERVICE_SELECTOR` only re-checks Services that existed before the change,
so a newly added Service selecting a pod label no workload carries clears
every policy and is caught only by the sandbox. That is the failure mode the
gate is honest about not catching, which is why the scenario exists.

## Security fixes

- **401 for an undecodable JWT signature.** A signature segment that is not
  valid base64url escaped the OIDC decoder as a `DOMException` and surfaced as
  HTTP 500. It is now the same `AuthenticationError` every other malformed
  segment produces, refused before any JWKS fetch. (#24)
- **Provider calls are bounded.** Every OpenAI, Anthropic, and Ollama call now
  runs under a 60s default deadline and a 2 MiB response cap enforced during
  the read, composed with — not replacing — a caller-supplied `AbortSignal`.
  `AnalyzeOptions` accepts `timeoutMs` and `maxResponseBytes` for slower local
  models. This is a behavior change for library consumers who previously
  relied on an unbounded wait. (#26)
- **`SECURITY.md` matches what shipped.** The authenticated server, ledger
  integrity, and signature-vs-integrity boundaries are now named in scope,
  and the two runtimes have separate documented boundaries. (#25)
- **Dependency advisory cleared.** The high-severity `brace-expansion`
  advisory in the ESLint tree is resolved by pinned overrides; `npm audit`
  reports zero vulnerabilities. (#27)

## Known limits

- Terraform cannot currently catch command smuggling: it is an external-diff
  domain with no simulator, and no Terraform policy inspects planned attribute
  values. This is tracked in #55 rather than papered over with a scenario the
  gate would not actually refuse.
- `changesafe eval` still runs against the Network corpus only.
