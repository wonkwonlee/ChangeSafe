# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/wonkwonlee/ChangeSafe/security/advisories/new)
rather than a public issue. Include a description, affected files or
versions, and a reproduction if you have one. Expect an initial response
within a week; this is a small project without a dedicated security team.

## What counts as a vulnerability here

ChangeSafe's security posture is defined by its safety invariants
(`CLAUDE.md`) and threat model (`docs/THREAT_MODEL.md`). The following are
in scope and treated as high severity:

- **Gate bypass** — any way to reach an approved or simulated outcome for a
  proposal carrying a `BLOCK` finding, at any layer (domain, API, CLI).
- **Execution surface** — any code path that could reach real
  infrastructure (device protocols, shell execution, `terraform apply`,
  arbitrary outbound requests driven by input data).
- **Secret leakage** — model API keys or other credentials reaching client
  bundles, receipts, fixtures, logs, or user-visible errors.
- **Policy unsoundness** — a crafted input where a policy returns `PASS`
  for a change it is specified to block (for example a management-severing
  change that `MGMT_REACHABILITY` misses).
- **Receipt integrity** — producing a receipt whose recorded hash does not
  correspond to its content, or altering content while keeping a valid hash.
- **Untrusted-input escape** — content in an incident, plan, or context
  file that changes system behavior rather than being treated as data.
- **Authenticated server bypass** — on the self-hosted decision API
  (`@changesafe/server`, `changesafe serve`): accepting a token that should
  not authenticate, granting an approver authority the deployment did not
  configure, recording a decision whose findings were not recomputed
  server-side, or returning a decision that was not appended to the ledger
  first. Authentication grants no new power over the gate; a way to make it
  do so is a gate bypass.
- **Ledger tampering** — altering, removing, or reordering a ledger entry
  without `changesafe ledger verify` detecting it. The append-only guarantee
  rests on SQLite triggers *and* a hash chain; defeating either is in scope.
- **Signature confusion** — presenting an unverified or unsigned receipt as
  a verified one, or making `changesafe verify` exit `0` when it was given
  no trusted key to check a signature against (it must exit `2`).

## Two runtimes, two boundaries

These are separate security surfaces and are best reported as such:

- **Public replay** (the bundled workbench at `/` and the domain
  subroutes) evaluates only. It has no approver identity, and it produces
  no decision, simulation record, durable review, or receipt. There is
  nothing there for an attacker to gain authority over, which is why
  client-side manipulation of it is not a vulnerability.
- **The self-hosted decision API** is authenticated and authority-bearing:
  OIDC identity, server-side recomputation of findings, signed receipts,
  and a ledger append that precedes the response. It is fully in scope.

## Explicitly not vulnerabilities

- **A model proposing an unsafe change.** That is the expected input; the
  deterministic gate exists precisely because model output is untrusted.
  A finding is only a vulnerability if the gate then fails to block it.
- **Prompt injection influencing model output.** Safety must not depend on
  the model resisting injection. Report it if the injection changes a
  *policy* outcome, not if it merely changes the proposal.
- **Client-side state manipulation in the public replay workbench.** That
  surface evaluates and displays; it carries no approver identity and
  issues no decision or receipt, so there is no authority to escalate and
  no second party to deceive. This is documented in
  `docs/THREAT_MODEL.md`. The equivalent manipulation against the
  authenticated self-hosted API *is* in scope — see above.
- **Receipts lacking signatures.** Signing is implemented
  (`packages/core/src/signature.ts`, `changesafe keygen`) but optional. An
  unsigned receipt proves integrity, not authorship, and that is the
  documented contract rather than a defect. A signature is meaningful only
  when checked against a public key obtained out of band; a receipt that
  merely *carries* a signature claims nothing on its own.

## Supported versions

The project is pre-1.0. Only `main` receives fixes; there are no
backported releases yet.
