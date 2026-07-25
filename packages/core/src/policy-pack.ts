import { z } from "zod";

/**
 * Typed parameters for the universal policies.
 *
 * A pack tunes thresholds that a team legitimately disagrees about — it is
 * deliberately *not* a policy language. There is no expression syntax and no
 * interpreter, so a pack can never make the gate unsound; the worst a bad
 * pack can do is make the gate stricter or looser within bounds the code
 * already understands.
 */
export const PolicyPackSchema = z
  .strictObject({
    /** Human-readable label recorded nowhere; for the pack author's benefit. */
    name: z.string().min(1).max(64).optional(),
    blastRadius: z
      .strictObject({
        /** Unit count at which the change warns. */
        warnAt: z.number().int().min(1).max(1000),
        /** Unit count above which the change is blocked. */
        blockAbove: z.number().int().min(1).max(1000),
      })
      .optional(),
    verification: z
      .strictObject({
        requirePrecondition: z.boolean(),
        requirePostcheck: z.boolean(),
      })
      .optional(),
  })
  .superRefine((pack, ctx) => {
    if (pack.blastRadius && pack.blastRadius.warnAt > pack.blastRadius.blockAbove) {
      ctx.addIssue({
        code: "custom",
        path: ["blastRadius"],
        message: "warnAt must not exceed blockAbove",
      });
    }
  });

export type PolicyPack = z.infer<typeof PolicyPackSchema>;

/** Fully resolved parameters — what policies actually read. */
export interface ResolvedPolicyPack {
  blastRadius: { warnAt: number; blockAbove: number };
  verification: { requirePrecondition: boolean; requirePostcheck: boolean };
}

/** The behavior ChangeSafe ships with; a pack overrides only what it names. */
export const DEFAULT_POLICY_PACK: ResolvedPolicyPack = {
  blastRadius: { warnAt: 2, blockAbove: 2 },
  verification: { requirePrecondition: true, requirePostcheck: true },
};

export function resolvePolicyPack(pack?: PolicyPack | null): ResolvedPolicyPack {
  return {
    blastRadius: { ...DEFAULT_POLICY_PACK.blastRadius, ...pack?.blastRadius },
    verification: { ...DEFAULT_POLICY_PACK.verification, ...pack?.verification },
  };
}
