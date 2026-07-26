import type { PolicyContext, PolicyFinding } from "@changesafe/core";

import type {
  PlannedChange,
  ResolvedTerraformPack,
  TerraformInput,
} from "./schemas";

export type TerraformPolicyContext = PolicyContext<TerraformInput, TerraformInput>;

/** Injected by the adapter so policies stay pure functions of their context. */
export interface TerraformPolicyDeps {
  pack: ResolvedTerraformPack;
}

const DESTRUCTIVE: PlannedChange["action"][] = ["delete", "replace"];

/**
 * A tag name is operator-supplied and a tag map is plain plan data, so a name
 * that happens to exist on `Object.prototype` ("constructor") would otherwise
 * read back an inherited function instead of a tag that was never set.
 */
function tag(tags: Record<string, string>, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(tags, name) ? tags[name] : undefined;
}

export function isStateful(change: PlannedChange, pack: ResolvedTerraformPack): boolean {
  const type = change.resourceType.toLowerCase();
  return pack.statefulResourcePatterns.some((pattern) => type.includes(pattern.toLowerCase()));
}

export function isProtected(change: PlannedChange, pack: ResolvedTerraformPack): boolean {
  if (tag(change.tags, pack.protectedTag)?.toLowerCase() === "true") return true;
  return pack.protectedAddressPatterns.some((pattern) => matchesAddress(change.address, pattern));
}

function hasBackup(change: PlannedChange, pack: ResolvedTerraformPack): boolean {
  return tag(change.tags, pack.backupTag)?.toLowerCase() === "true";
}

/**
 * Glob matching limited to `*`, matched directly rather than compiled to a
 * regex.
 *
 * Translating each `*` into `.*` looks equivalent and is not: a pattern with
 * several stars backtracks catastrophically against a long non-matching
 * address, so a pack of ordinary-looking patterns could hang the gate — and a
 * gate that never answers is a CI job that never finishes. This scan is
 * linear in the address per star, with no backtracking to explode.
 */
export function matchesAddress(address: string, pattern: string): boolean {
  let addressIndex = 0;
  let patternIndex = 0;
  // Where to resume if the current star's guess turns out to be too short.
  let starIndex = -1;
  let addressAfterStar = 0;

  while (addressIndex < address.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === address[addressIndex]) {
      addressIndex += 1;
      patternIndex += 1;
    } else if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
      starIndex = patternIndex;
      addressAfterStar = addressIndex;
      patternIndex += 1;
    } else if (starIndex >= 0) {
      // Let the most recent star absorb one more character and retry.
      patternIndex = starIndex + 1;
      addressAfterStar += 1;
      addressIndex = addressAfterStar;
    } else {
      return false;
    }
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === "*") {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

/**
 * DESTRUCTIVE_OP — what class of thing is this plan destroying?
 *
 * Destroying capacity is routine; destroying state is how an incident becomes
 * an outage with no way back. Stateful destruction blocks unless the resource
 * carries an explicit backup marker, which downgrades it to a warning that
 * still shows up in the receipt.
 */
export function evaluateDestructiveOp(
  context: TerraformPolicyContext,
  deps: TerraformPolicyDeps,
): PolicyFinding {
  const { pack } = deps;
  const destructive = context.input.changes.filter((change) =>
    DESTRUCTIVE.includes(change.action),
  );

  if (destructive.length === 0) {
    return {
      policyId: "DESTRUCTIVE_OP",
      status: "PASS",
      title: "No resource is destroyed or replaced",
      explanation: `All ${context.input.changes.length} planned change(s) create or update resources in place.`,
      affectedResources: [],
      remediation: null,
    };
  }

  const statefulBlocking = destructive.filter(
    (change) => isStateful(change, pack) && !hasBackup(change, pack),
  );
  const statefulWithBackup = destructive.filter(
    (change) => isStateful(change, pack) && hasBackup(change, pack),
  );
  const stateless = destructive.filter((change) => !isStateful(change, pack));

  if (statefulBlocking.length > 0) {
    return {
      policyId: "DESTRUCTIVE_OP",
      status: "BLOCK",
      title: "Plan destroys stateful resources",
      explanation:
        `${statefulBlocking.length} stateful resource(s) would be destroyed or replaced: ` +
        statefulBlocking
          .map((change) => `${change.address} (${change.action})`)
          .join(", ") +
        `. Destroying these loses data, not just capacity.`,
      affectedResources: statefulBlocking.map((change) => `resource:${change.address}`),
      remediation: `Remove the destroy from the plan, or mark the resource with the "${pack.backupTag}" tag once a restorable backup exists.`,
    };
  }

  const warned = [...statefulWithBackup, ...stateless];
  return {
    policyId: "DESTRUCTIVE_OP",
    status: "WARN",
    title: "Plan destroys or replaces resources",
    explanation:
      `${warned.length} resource(s) would be destroyed or replaced: ` +
      warned.map((change) => `${change.address} (${change.action})`).join(", ") +
      (statefulWithBackup.length > 0
        ? `. ${statefulWithBackup.length} of these are stateful and rely on the declared "${pack.backupTag}" tag.`
        : `. None hold state, so the loss is capacity rather than data.`),
    affectedResources: warned.map((change) => `resource:${change.address}`),
    remediation: "Confirm the destruction is intended and the timing is acceptable.",
  };
}

/**
 * PROTECTED_RESOURCE — some resources are simply not destroyable by an
 * automated change, whatever the reasoning attached to it.
 */
export function evaluateProtectedResource(
  context: TerraformPolicyContext,
  deps: TerraformPolicyDeps,
): PolicyFinding {
  const { pack } = deps;
  const violations = context.input.changes.filter(
    (change) => DESTRUCTIVE.includes(change.action) && isProtected(change, pack),
  );

  if (violations.length === 0) {
    return {
      policyId: "PROTECTED_RESOURCE",
      status: "PASS",
      title: "No protected resource is destroyed",
      explanation:
        pack.protectedAddressPatterns.length > 0
          ? `No plan entry destroys a resource matching the ${pack.protectedAddressPatterns.length} protected pattern(s) or carrying the "${pack.protectedTag}" tag.`
          : `No plan entry destroys a resource carrying the "${pack.protectedTag}" tag.`,
      affectedResources: [],
      remediation: null,
    };
  }

  return {
    policyId: "PROTECTED_RESOURCE",
    status: "BLOCK",
    title: "Plan destroys a protected resource",
    explanation:
      violations
        .map((change) => `${change.address} is protected and would be ${change.action}d`)
        .join("; ") + ". Protected resources cannot be destroyed by a gated change.",
    affectedResources: violations.map((change) => `resource:${change.address}`),
    remediation:
      "Remove the destroy, or lift the protection deliberately in a separate, reviewed change.",
  };
}

/**
 * REVERSIBILITY — could this be put back?
 *
 * Replaces core's ROLLBACK_COMPLETE, which asks whether an author supplied
 * inverse operations. A plan has no inverse to supply, so the honest question
 * is whether the plan itself records enough to reconstruct what it removes.
 */
export function evaluateReversibility(
  context: TerraformPolicyContext,
  deps: TerraformPolicyDeps,
): PolicyFinding {
  const { pack } = deps;
  const destructive = context.input.changes.filter((change) =>
    DESTRUCTIVE.includes(change.action),
  );

  const unrecorded = destructive.filter((change) => change.before === null);
  if (unrecorded.length > 0) {
    return {
      policyId: "REVERSIBILITY",
      status: "BLOCK",
      title: "Destroyed resources have no recorded prior state",
      explanation:
        `${unrecorded.length} destroyed or replaced resource(s) carry no "before" state in the plan: ` +
        unrecorded.map((change) => change.address).join(", ") +
        ". Without it there is nothing to reconstruct from.",
      affectedResources: unrecorded.map((change) => `resource:${change.address}`),
      remediation:
        "Regenerate the plan against current state so prior values are recorded, then re-gate.",
    };
  }

  const dataAtRisk = destructive.filter(
    (change) => isStateful(change, pack) && !hasBackup(change, pack),
  );
  if (dataAtRisk.length > 0) {
    return {
      policyId: "REVERSIBILITY",
      status: "WARN",
      title: "Configuration is recoverable, data is not",
      explanation:
        `The plan records prior configuration for every destroyed resource, so infrastructure can be rebuilt. ` +
        `However ${dataAtRisk.length} of them hold state (${dataAtRisk
          .map((change) => change.address)
          .join(", ")}), and their contents are not in the plan.`,
      affectedResources: dataAtRisk.map((change) => `resource:${change.address}`),
      remediation: `Confirm a restorable backup exists and mark it with the "${pack.backupTag}" tag.`,
    };
  }

  return {
    policyId: "REVERSIBILITY",
    status: "PASS",
    title: destructive.length === 0 ? "Nothing to reverse" : "Prior state is recorded",
    explanation:
      destructive.length === 0
        ? "The plan destroys nothing, so every change can be undone by reverting the code."
        : `The plan records prior state for all ${destructive.length} destroyed or replaced resource(s), and none hold unrecoverable data.`,
    affectedResources: [],
    remediation: null,
  };
}
