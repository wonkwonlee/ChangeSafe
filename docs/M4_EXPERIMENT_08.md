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

Checks: `tests/integration/m4-terraform-structure.test.ts` (10 tests). No
Terraform was executed and no cloud contacted.

**The documented formats** (HashiCorp's JSON output format page, read
2026-10-11 through a summarizing fetch, so the lists below are what that
read reported, not verbatim code blocks; the page should be consulted to
audit them). For the *state representation* the page's example shows
`values` and `terraform_version`, and says state "does not have any
significant metadata not included in the common" values representation;
every output carries a `format_version`. The *plan representation's*
listed top-level properties were `format_version`, `prior_state`,
`applyable`, `complete`, `errored`, `configuration`, `planned_values`,
`proposed_unknown`, `variables`, `resource_changes`, `resource_drift`,
`relevant_attributes`, `output_changes` and `checks`. Two direct
questions about `serial` and `lineage` were both answered "not
mentioned". The page also tells consumers to ignore properties they do not
recognize. The weight of H8a therefore rests on the absence of those two
names from the format, which the two reads agree on, and not on the exact
property lists.

| # | Prediction | Observed |
| --- | --- | --- |
| H8a | holds (high) | **holds.** None of the seven committed inputs has a key named `serial`, `lineage` or `prior_state` at any depth. The test asserts the *whole* set of key names across the inputs (an allowlist of 27), so a new key is noticed; none is an identity or version key. The normalized model keeps only address, type, module, action, before, after, tags and ids |
| H8b | holds (high) as an argument; the test checks the artifact's shape only | **holds, with what a test can show kept apart from what it cannot.** Tags appear in the same `before` and `after` values as every other attribute, and the normalized model has no field named for a grant, receipt, carrier or authorization. That anyone who can write the resource can write its tags is a property of Terraform and the provider, argued here, not read off an artifact |
| H8c | holds (medium); **a consequence, not evidence** | **holds, and trivially.** With the model's carrier flag off, neither repair returns a `stored` verdict in any of the 28,800 default-tier evaluations (every coverage, prior and audit edit), both are sound, and the definite verdicts are exactly `rejected` and `not_consumed`. The tests restate the model's own `!assumeCarrierUnforgeable` branch; their content is the premise that the artifact offers no carrier (H8b) and that the default tier stands for a Terraform state history, which is an interpretation, not shown |
| H8d | holds (high) | **holds, and wider than asked.** `deriveReviewedGrantBinding` throws "Only Kubernetes has a reviewed grant issuance contract" for Terraform, for network and for any other domain string (its first statement, so it is about the domain, not the input). The server has one `signGrant` call site, preceded by that derivation, and no other server source signs a grant. One of the three shipped domains can be issued a grant |

## What the result says

1. **The contract's structure did not reappear on its own, under this
   interpretation.** The three things it rests on are properties of a
   Kubernetes API server: an incarnation identity and a monotonic version
   on every object, and a boundary that sees the request before it
   persists and can set a field the executor cannot. Terraform has the
   first two in its raw state (`lineage`, `serial`) and its documented JSON
   output does not list them; it has no counterpart of the third. For the
   strategy's "Physical OS" question (does the abstraction reappear
   unprompted?) this is a negative answer *for these two domains and for
   this model of the mapping*. It needed an enforcement boundary, and
   Terraform's gate ends before one. It is not a refutation of the
   hypothesis: the mapping from a watch to a state backend's history is
   an interpretation (below), and a third domain was not tried.
2. **For Terraform the sound observation is one-sided, by construction.**
   With no carrier the model can say that a grant was consumed and that no
   state version after it holds the target (`rejected`), never that the
   apply is the grant's. That asymmetry follows from the missing boundary
   and is not a finding about the contract's wording.
3. **Where a Terraform carrier would have to come from is outside what
   ChangeSafe ingests.** The nearest real mechanism is the cloud's own
   identity and audit trail: an apply role assumable only with a session
   name derived from the grant, and API events attributed to that
   session. That would be set by the cloud's IAM, not by a tag, but a
   session name is chosen by whoever assumes the role within the pattern a
   trust policy allows and is not single-use. Whether it can carry the
   carrier's guarantee is untested.
4. **The grant primitive is domain-agnostic in its schema and
   Kubernetes-only in its use.** `AuthorizationGrant`'s fields are opaque
   strings, but its issuance exists for one domain, as does its enforcer
   and its observation contract. The strategy and README describe the
   primitive generally; the code supports one domain.

## What remains unsupported

- The committed inputs are authored and minimal; a real plan carries
  more. The documented format is the stronger source, and it was read
  through a summarizing fetch, not run against a real Terraform.
- H8c rests on the model's default tier standing for Terraform, which is
  an interpretation: the model has a stream of object versions and
  Terraform's analog is a versioned backend's state history, with each
  serial retained. Whether a given backend retains them is operator
  configuration and not checked.
- Nothing here tests the cloud audit-trail idea; it is named, not run.

## Next question

> **Can an identity boundary the cloud already enforces (a role assumable
> only through a session whose name carries the grant, with the provider's
> API audit attributing every call to that session) supply the carrier a
> Terraform apply lacks, and what does it fail to give?**

It is the one place the missing boundary could come from without ChangeSafe
executing anything. It cannot be tested here without a cloud and is
therefore not scheduled; what the loop does next is state the observation
contract once, for core, with these preconditions written on it.
