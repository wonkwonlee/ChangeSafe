# ChangeSafe Launch Kit

Owner-facing copy and verification steps. Nothing in this file publishes,
deploys, tags, or posts automatically.

## Release truth

- **`v0.5.0` is the canonical package/tag release, published and
  registry-verified** (2026-08-07). All five packages record
  `.github/workflows/publish.yml` in `wonkwonlee/ChangeSafe` at
  `refs/tags/v0.5.0`, commit `c1ae07e`, and `npm audit signatures` reports
  verified registry signatures and verified attestations for the installed
  tree (`npm view changesafe@0.5.0 dist.attestations` — `gitHead` matches
  `c1ae07e`). The registry-installed CLI was exercised end to end: it gates
  a destructive Terraform plan to exit 1 with `PLAN_CONTEXT_REQUIRED`
  visible in the findings, and `@changesafe/domain-kubernetes` imports
  directly under Node ESM. It carries a universal-policy skip legitimacy
  fix in `@changesafe/core` (a domain adapter could previously skip any
  universal policy, not just the two the shape permits, with no enforcement
  outside the app's own registration path), a new Terraform
  `PLAN_CONTEXT_REQUIRED` policy replacing a prose-only
  `VERIFICATION_REQUIRED` skip, every receipt now recording
  `policyCoverage`, and `changesafe eval` gaining Kubernetes support.
  `CORE_POLICY_VERSION` moved to `core-v0.2.0` and `TERRAFORM_POLICY_VERSION`
  to `terraform-v0.2.0` — a v0.5.0 receipt is not directly comparable to a
  v0.4.x one. See [RELEASE_NOTES_v0.5.0.md](RELEASE_NOTES_v0.5.0.md).
- `v0.4.1` was the canonical package/tag release before v0.5.0: the complete
  published set of the multi-domain workbench, and the first to go out
  through the trusted publishing workflow rather than a manual publish.
- **Do not point anyone at `0.4.0`.** It published three of five packages
  before failing, so the CLI and the Kubernetes domain do not exist at that
  version. The three that shipped are genuine and carry provenance; the set is
  simply incomplete. See [RELEASE_NOTES_v0.4.1.md](RELEASE_NOTES_v0.4.1.md).
- `@changesafe/domain-kubernetes@0.3.0` is deprecated because its direct Node
  ESM imports were invalid; use `0.3.1` or later.
- v0.3.0 and v0.3.1 were manually published and do **not** carry npm
  provenance attestations.
- v0.4.1's attestations were verified (2026-08-07) the same way, at
  `refs/tags/v0.4.1`, commit `bafdeeb`.
- The vNext UI cutover (#47, #48, #49) is merged to `main` and deployed to
  the hosted Vercel URL. It does not itself create an npm release, Git tag,
  or GitHub Release.

## vNext deployment pre-flight

Run the repository gate first:

```bash
npm run lint
npm run typecheck
npm run build:packages
npm run build:cli
npm test
npm run build
npm run verify:client-bundles
node packages/cli/dist/changesafe.js scenario check
node packages/cli/dist/changesafe.js scenario gallery --check
PORT=3100 npm run test:e2e
```

After deploying a reviewed commit, verify:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://change-safe.vercel.app/
curl -sS -o /dev/null -w '%{http_code}\n' https://change-safe.vercel.app/workbench
curl -sS -X POST -o /dev/null -w '%{http_code}\n' https://change-safe.vercel.app/api/analyze
curl -sS -o /dev/null -w '%{http_code}\n' https://change-safe.vercel.app/workbench/terraform
curl -sS -o /dev/null -w '%{http_code}\n' https://change-safe.vercel.app/workbench/kubernetes
curl -sS -o /dev/null -w '%{http_code}\n' https://change-safe.vercel.app/workbench/self-hosted
```

Expected after the vNext deployment:

- `/` → 200 and the Network public replay workbench;
- exact `/workbench` → 404;
- exact `POST /api/analyze` → 404;
- Terraform, Kubernetes, and self-hosted subroutes → 200.

Also exercise `POST /api/reviews/analyze` with a request body: it must
reject a malformed one against the versioned review contract (400, not
404), proving the route is live and schema-enforced rather than absent.

**Verified 2026-07-30**: all of the above pass against the hosted
deployment. The hosted URL currently serves the vNext workbench — safe to
use as demo and cutover evidence.

## Short product description

> ChangeSafe is a deterministic airlock for AI-proposed infrastructure
> changes. It validates typed proposals with pure policies, derives risk
> without model confidence, and makes every BLOCK unapprovable. It never
> executes infrastructure changes.

## Public workbench description

> The vNext public workbench is keyless and replay-only. Network, Terraform,
> and Kubernetes examples expose their evidence, policy coverage, source
> capability, findings, and risk. Public replay is ephemeral: it creates no
> human decision, sandbox result, durable review, or receipt.

Do not say that every public replay produces a receipt or that the public UI
offers approval. Those claims are false after the cutover.

## Terraform/CI description

> ChangeSafe reads the `terraform show -json` artifact your pipeline already
> produced. It never runs Terraform or holds cloud credentials. Destructive
> and protected changes are evaluated deterministically, and untrusted PR text
> remains data rather than instructions.

Example:

```yaml
- name: ChangeSafe gate
  uses: wonkwonlee/ChangeSafe@v0.5.0
  with:
    plan: tfplan.json
    context: pr-body.txt
```

CLI exit codes are part of the safety contract: 0 means evaluated with no
BLOCK, 1 means BLOCKED, and 2 means no verdict could be produced. The CLI
never approves; optional receipts say `gate_only` or `blocked`.

## Kubernetes description

> ChangeSafe gates supported proposed Kubernetes manifests against an offline
> snapshot. The gate contacts no cluster and applies no manifest. The optional
> collector is a separate namespace-scoped read-only tool that rejects
> executable credential plugins and writes a validated snapshot atomically.

Use `@changesafe/domain-kubernetes@0.3.1` or later.

## Self-hosted description

> The authenticated server verifies OIDC identity, recomputes findings, drives
> the same core state machine, signs receipts when configured, and appends
> successful decisions to a hash-chained SQLite ledger before responding. A
> legitimate operator still cannot approve a BLOCK.

Important deployment limits:

- The vNext browser route needs an operator-run HTTPS gateway/BFF that holds
  an HttpOnly authenticated session and supplies OIDC bearer tokens upstream.
- `CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL` is public configuration and may
  contain no credential.
- `changesafe serve --reviews-db <file>` instantiates `DurableReviewStore`
  and enables the vNext review queue; omit the flag to keep it disabled.
- ChangeSafe provides no infrastructure execution endpoint.

## Answers to expected questions

**Is this OPA/Sentinel/Conftest?**

If an existing policy-as-code tool already covers the artifact and policies
you need, use it. ChangeSafe concentrates on typed AI-proposed changes,
untrusted accompanying context, a cross-domain adapter contract, deterministic
risk, and explicit provenance/receipt claims.

**Does it replace Batfish or Forward Networks?**

No. The Network model is intentionally synthetic. A production reachability
oracle is a future integration target, not a capability already earned.

**What stops bypass?**

Nothing if the gate is not required by your workflow. ChangeSafe is a check,
not a control plane.

**Why trust a receipt?**

A canonical hash detects content alteration. Authorship requires an Ed25519
signature verified against the expected public key obtained out of band.
Ledger inclusion is a separate claim. ChangeSafe is not an external
timestamping or non-repudiation service.

**Does it execute the change after approval?**

No. Humans and their existing systems execute. This invariant applies to the
public workbench, CLI, collector, and self-hosted server.

## Posting checklist

- Link only to a deployment whose routes were verified above.
- Use current test counts only from the exact commit being announced; avoid
  hard-coding counts in evergreen copy.
- State that the corpus is synthetic and small.
- Distinguish one captured fixture from authored synthetic/red-team fixtures.
- State package provenance honestly.
- Stay available to answer questions and correct any deployment drift.
