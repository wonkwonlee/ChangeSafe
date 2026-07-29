import { z } from "zod";
import { ChangeOpKindSchema } from "./proposal";
import { IdSchema, JsonValueSchema, StatePathSchema } from "./primitives";

/** Structured before/after entry produced by a domain's patch engine. */
export const DiffEntrySchema = z.strictObject({
  op: ChangeOpKindSchema,
  path: StatePathSchema,
  before: JsonValueSchema.nullable(),
  after: JsonValueSchema.nullable(),
});

/**
 * The sandbox outcome. Domains that simulate (rather than consuming a
 * precomputed external diff) report which resources changed and whether the
 * declared safety properties still hold.
 */
export const SimulationResultSchema = z.strictObject({
  status: z.literal("completed"),
  changedResourceIds: z.array(z.string().min(1).max(256)).min(1).max(5000),
  diff: z.array(DiffEntrySchema).min(1).max(5000),
  safetyProperties: z.array(
    z.strictObject({
      propertyId: IdSchema,
      satisfied: z.boolean(),
      detail: z.string().min(1).max(500),
    }),
  ),
  summary: z.string().min(1).max(2000),
});

export type DiffEntry = z.infer<typeof DiffEntrySchema>;
export type SimulationResult = z.infer<typeof SimulationResultSchema>;
