# Does the structure the observation contract rests on exist in Terraform, and does the artifact ChangeSafe ingests carry it?

Status: **pre-registered 2026-10-11, before the checks were written.** The
hypotheses and predictions below were committed first. The Results section
is added afterward, and the predictions are not edited.

[Experiment 07](M4_EXPERIMENT_07.md)'s contract is sound in one tier and
unsound outside it, and it rests on three things the Kubernetes API server
provides: an **incarnation identity** (`metadata.uid`), a **monotonic
version** (`resourceVersion`), and a **field only the authorizing boundary
can set** (the grant carrier, enforced by an admission webhook that fails
closed). This iteration asks whether those exist for the other
external-diff domain ChangeSafe ships, Terraform, and whether the artifact
the Terraform domain ingests carries them. It is the first iteration to
test the strategy's "Physical OS" hypothesis in the narrow form the
project's own rule allows: whether the abstraction reappears *on its own*
in a second domain, or has to be imported.

Decision filter: A yes (is the E1 to E2 structure Kubernetes-specific);
B yes (Terraform state lineage and serial, what `show -json` omits,
STS session names as an attribution carrier); C yes; D yes. If the
structure does not carry over, the project's domain-agnostic
`AuthorizationGrant` has only one domain it can be issued in, which no
current document says.

## What is checked

1. **The ingested artifact.** The documented JSON output format of
   `terraform show -json` (state and plan representations), the repo's
   `TerraformPlanSchema` and normalized model, and the seven committed
   Terraform scenario inputs, scanned for any key named `serial` or
   `lineage`, or for a field that could serve as a per-object version.
2. **The grant path.** `packages/server/src/grant-binding.ts`, which
   decides which domains can be issued an `AuthorizationGrant`.
3. **The contract's behavior without a carrier.** Experiment 07's model,
   with the carrier unavailable (the default-tier setting), which is the
   situation a Terraform artifact is in if nothing in it plays the part.

## Hypotheses and predictions

| # | Hypothesis | Prediction | Confidence |
| --- | --- | --- | --- |
| H8a | Neither the documented `terraform show -json` formats, nor the repo's schema, nor any of the seven committed Terraform inputs carries a state `serial` or `lineage` | holds | high: a read of the formats and a key scan |
| H8b | No field of that artifact can play the carrier's part. The nearest candidate, resource `tags`, is written by anyone who can write the resource configuration or the resource, so the contract's precondition cannot be met from the artifact | holds | high |
| H8c | Run through experiment 07's model with no unforgeable carrier, the contract returns no `stored` verdict, and its only definite verdicts are `rejected` (absence in a complete window) and `not_consumed`; "stored" is unreachable for Terraform from this artifact | holds | medium: depends on how faithfully the model's default tier stands for Terraform |
| H8d | `AuthorizationGrant` issuance is Kubernetes-only in code: a Terraform review cannot be issued a grant, so the Terraform domain's gate ends at E0 | holds | high |

**What would count as a surprising result.** If any committed Terraform
input carries a serial, lineage, or a per-resource version, H8a fails and
the artifact is richer than the documentation says. If H8d fails, a
Terraform grant path exists that no document or test covers.

## Limits stated in advance

- The seven committed inputs are authored and minimal. A real
  `terraform show -json` plan is richer, so a clean scan of them is weak
  evidence about real plans; the documented format is the stronger source,
  and it is read, not run.
- No Terraform is executed and no cloud is contacted (invariant 1). The
  question of whether a cloud's own audit trail (for example API events
  attributed to a role session whose name embeds a grant id) could play the
  carrier's part is *not* tested here and is named as the next question.
- The model in H8c is Kubernetes-shaped. Mapping its watch to a versioned
  state backend's history is an interpretation, stated as one.

## Results

Pending.
