import type { PolicyFinding, SkippableUniversalPolicyId } from "./findings";
import type { PolicyPack, ResolvedPolicyPack } from "./policy-pack";
import type { ChangeOperation, ChangeProposal } from "./proposal";
import type { DiffEntry } from "./simulation";

/**
 * The contract a domain implements so core's universal policies can run
 * against it without knowing anything about networks, plans, or clusters.
 *
 * Two domain shapes are supported:
 *
 * - **Simulated-state** (this interface): the domain holds a declarative
 *   state model and applies typed operations transactionally to a clone.
 * - **External-diff**: the diff arrives precomputed (for example a Terraform
 *   plan). Such a domain implements `applyOperations` as a no-op reporter or
 *   declares the rollback policy inapplicable; see docs/OSS_ROADMAP.md §5.
 *
 * Everything here must stay pure: no IO, no clock, no randomness, and never
 * a model call.
 */
export interface DomainAdapter<TInput = unknown, TState = unknown> {
  /** Stable identifier, e.g. "network". Recorded alongside findings. */
  readonly domainId: string;

  /** Version of this domain's policy behavior; composed into receipts. */
  readonly policyVersion: string;

  /** The mutable state the patch engine operates on, extracted from the input. */
  stateOf(input: TInput): TState;

  /**
   * Apply operations transactionally to a deep clone. Must throw (never
   * partially mutate) when any operation is invalid, so callers can treat a
   * throw as "this change cannot be proven safe".
   */
  applyOperations(state: TState, operations: ChangeOperation[]): {
    nextState: TState;
    diff: DiffEntry[];
  };

  /**
   * The unit an operation's blast radius is counted in — typically a device,
   * resource, or module. `null` when the operation targets nothing the
   * domain recognizes, which core treats as unassessable (fail closed).
   */
  blastRadiusUnit(operation: ChangeOperation): { kind: string; id: string } | null;

  /**
   * Free-text fields of the input that originate outside the system and must
   * be treated as data. Core scans these for instruction-like language.
   */
  untrustedTexts(input: TInput): { evidenceId: string; kind: string; text: string }[];

  /** Every evidence id a proposal is allowed to cite. */
  knownEvidenceIds(input: TInput): Set<string>;

  /**
   * Policies specific to this domain. Declaring the id alongside the
   * evaluator lets core publish the exact policy order a domain produces
   * without calling anything.
   */
  readonly policies: readonly DomainPolicy<TInput, TState>[];

  /**
   * Thresholds this domain considers sane before any user pack applies.
   * A plan touching twelve cloud resources is ordinary; twelve network
   * devices during an incident is not.
   */
  readonly defaultPolicyPack?: PolicyPack;

  /**
   * Universal policies this domain does not run, each with the reason and
   * what answers the same question instead.
   *
   * This is deliberately verbose: silently dropping a safety check is how
   * gates rot. A skip appears in `policyOrder`, in receipts (never merely by
   * a policy's absence — `policyCoverage.skippedPolicies` records it), and
   * must name a real replacement. Only `SkippableUniversalPolicyId` may be
   * named here; `evaluatePolicies` and `policyOrder` both throw for any
   * other policy id or for a `replacedBy` that names a domain policy the
   * adapter does not actually declare — a domain cannot self-certify a skip
   * that core cannot verify.
   */
  readonly skippedUniversalPolicies?: readonly SkippedUniversalPolicy[];
}

/**
 * What actually answers the question a skipped universal policy would have.
 *
 * `"domain-policy"` is checked: core verifies the named id is one of the
 * adapter's own `policies`, so a skip cannot point at a policy that does not
 * exist. `"out-of-band"` is for when the replacement is a real but
 * non-mechanical process (e.g. a required pull request review) — core
 * cannot verify that a human actually performed it, so this kind is honest
 * about naming a process rather than a policy, and a receipt's
 * `policyCoverage` records the distinction rather than blurring it into
 * prose.
 */
export type SkipReplacement =
  | { readonly kind: "domain-policy"; readonly policyId: string }
  | { readonly kind: "out-of-band"; readonly process: string };

export interface SkippedUniversalPolicy {
  /** The universal policy that does not apply here. */
  readonly policyId: SkippableUniversalPolicyId;
  /** Why it cannot be evaluated in this domain. */
  readonly because: string;
  /** What answers the same question instead. */
  readonly replacedBy: SkipReplacement;
}

/**
 * The exact set of policies a domain's gate run produced or deliberately
 * skipped, computed by `computePolicyCoverage` and carried on every receipt.
 * A verifier reads this instead of the adapter source to know what a
 * receipt's absence of a policy id means.
 */
export interface PolicyCoverage {
  readonly orderedPolicyIds: readonly string[];
  readonly skippedPolicies: readonly SkippedUniversalPolicy[];
}

export interface DomainPolicy<TInput = unknown, TState = unknown> {
  readonly id: string;
  readonly evaluate: PolicyEvaluator<TInput, TState>;
}

/** Input handed to every policy. Pure data plus the domain's own capabilities. */
export interface PolicyContext<TInput = unknown, TState = unknown> {
  input: TInput;
  proposal: ChangeProposal;
  adapter: DomainAdapter<TInput, TState>;
  /** Resolved thresholds; defaults when the caller supplies no pack. */
  pack: ResolvedPolicyPack;
}

export type PolicyEvaluator<TInput = unknown, TState = unknown> = (
  context: PolicyContext<TInput, TState>,
) => PolicyFinding;
