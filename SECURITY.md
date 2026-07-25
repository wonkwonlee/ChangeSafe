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

## Explicitly not vulnerabilities

- **A model proposing an unsafe change.** That is the expected input; the
  deterministic gate exists precisely because model output is untrusted.
  A finding is only a vulnerability if the gate then fails to block it.
- **Prompt injection influencing model output.** Safety must not depend on
  the model resisting injection. Report it if the injection changes a
  *policy* outcome, not if it merely changes the proposal.
- **Client-side state manipulation in the single-user demo app.** The
  browser user is the approver; there is no second party to deceive and no
  execution surface. This is documented in `docs/THREAT_MODEL.md`. It
  becomes in scope once the server-side decision path ships (roadmap P6).
- **Receipts lacking signatures.** Known and documented: v0.1 receipts
  prove integrity, not authorship. Signing is roadmap P6.

## Supported versions

The project is pre-1.0. Only `main` receives fixes; there are no
backported releases yet.
