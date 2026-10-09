# Authorization model and candidate release self-review

Review scope: M2 evidence/claim currency, bounded M3 protocol model and
v0.6.0 package preparation. This is implementing-agent self-review; no
independent human review is claimed.

## Findings and corrections

- A disjunction on a TLA+ next-state assignment needed parentheses; the
  initial broken-object run failed with an incompletely specified successor,
  not the intended invariant counterexample. Corrected the action. The
  runner rejects semantic errors and requires exit 12 plus the named
  invariant and a trace for each negative case.
- The model deliberately abstracts durable first-write, receipt trust and
  canonical/hash authenticity. Documentation now separates those assumptions
  from tested TypeScript behavior; no refinement or cryptographic proof is
  claimed. Default-tier outage admission is represented explicitly.
- The first packed-grant smoke used generated PEM strings as CryptoKeys.
  Corrected the test to import the generated private PEM with the public
  package API before signing. The isolated packed package verifies a valid
  signature and refuses a modified actor.
- Release identity checks were pinned to 0.5.0 and omitted the enforcer.
  Updated the intentional candidate assertion and added the private enforcer
  to version/private-package checks. Historical M1 manifests remain pinned;
  the test of the current CLI now checks current binary identity, preserving
  the historical template's hashes/version and all verdict assertions.
- The private server imported the Kubernetes domain without declaring that
  internal dependency. Declared it as part of synchronized 0.6.0 workspace
  metadata. No public package set was expanded.
- Original M2 docs contain historical observations. Kept the historical
  technical note/findings, replaced the current example guide and server
  intake description, and retained the actual PR #76 CI transcript with
  provenance/digests. No old transcript is represented as a new local run.
- The private M0 table was not retrievable. Formal M2/M3 closure remains
  explicitly pending that evidence input. M4 selection is conditional;
  preparation does not silently mark a milestone closed or publish npm.

## Validation

Node 22.23.3/npm 10.9.8: lint, strict typecheck, CLI/package build,
production build, public client budgets/security scan, all 27 scenario
expectations and gallery currency. Full suite and packed consumer checks
are recorded in the PR's final validation summary. TLC checks both normal
configurations and all six required counterexamples; CI additionally
rejects drift in the checked-in result snapshot.

The isolated npm consumer installs all five local 0.6.0 tarballs outside
the workspace and runs a real destructive-plan gate. Publication collision
preflight found all five candidate versions available at check time; that
does not reserve the versions or replace the publish workflow's later check.

Local Chromium download repeatedly returned truncated archives. Docker/kind
are absent. The new PR CI must exercise Playwright and live admission on
this candidate; the preserved earlier kind run attests PR #76 only.
No code-path behavior in the gate/enforcer changed in this preparation.
