# Boundary completion review

Scope: owner-approved issuance binding, admission routing bypasses, durable
grant recovery/use-state. Review performed by the implementing agent; no
independent human or external reviewer approval is claimed.

## Review outcomes

- The HTTP intake schema alone was insufficient: receipts formerly hashed
  the Kubernetes policy projection, which drops fields needed for exact
  object authorization. The immutable snapshot/manifest bundle is now the
  server domain's audit input. Grant issuance rejects legacy raw-only input
  and post-approval changes to metadata the policy projection ignores.
- Grant issuance must verify a trusted ledgered receipt, not merely parse a
  receipt claiming approval. Recovery checks receipt integrity/signature and
  signed grant provenance. Operation/resource/hash remain server-derived.
- Response loss and storage failure need immutable intent BEFORE receipt
  creation. The first intent wins; receipt-derived grant identity and stable
  signing time make retries recover one capability. Concurrency tests require
  one receipt and identical grant data across successful responses.
- SQLite unique insertion is the single-use serialization point. Tests cover
  independent connections, multiple Node processes and restart. Replacement
  INSERTs cannot rewrite intent or consumption even when SQLite's recursive
  delete triggers are disabled.
- Consumption failure is HTTP 200 DENY, not a 500 that Ignore could admit.
  Dry-run does not consume a grant. E2/E3 and cross-node HA are not claimed.
- Namespace tier downgrade/delete is guarded independently of the selector.
  Protected Scale/HPA writes are denied, not treated as authorized parent
  updates. Real-cluster policy validation is a dedicated CI gate.
- CI exposed asynchronous intake validation reordering concurrent retries.
  Validation now runs inside the write queue, preserving the first call's
  acceptance timestamp without relaxing the existing regression assertion.
- Live CI confirmed namespace/Scale denials, then correctly refused the
  demo's spec change on an annotated immutable resource. The demo now uses
  namespace fail-closed routing without the separate spec-freeze annotation;
  policy verdicts are unchanged.

## Validation

Local: Node 22/npm 10.9.8; full Vitest suite, typecheck, ESLint, CLI/package
builds, production Next.js build, all 27 scenarios and generated gallery,
public client budgets/security scan, shell syntax and git diff checks.
Subprocess tests ran with NODE_NO_WARNINGS=1 to remove the environment's
injected proxy warnings; no assertions were weakened for those warnings.

Docker/kind were absent locally. Chromium download returned a truncated
archive. These checks are delegated to the existing Playwright CI job and
the new live admission reproduction job. The original committed transcript
is historical; fresh CI artifacts must be used for this extension's claim.
