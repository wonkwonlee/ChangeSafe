import { z } from "zod";

/** Shared identifier and value primitives. Nothing here is domain-specific. */

export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const IdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(ID_PATTERN, "identifiers are lowercase kebab-case");

export const EvidenceIdSchema = z
  .string()
  .max(64)
  .regex(/^ev-[a-z0-9]+(?:-[a-z0-9]+)*$/, "evidence ids look like ev-alert-001");

export const TimestampSchema = z.iso.datetime({ message: "UTC ISO-8601 timestamp required" });

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, "lowercase sha-256 hex");

/** Arbitrary JSON value — used for operation values, diffs, and captured state. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/**
 * Declarative state path, e.g. /devices/edge-rtr-01/routes/rt-a/metric.
 * Core only guarantees the shape; which paths are writable is a domain's
 * allowlist decision.
 */
export const StatePathSchema = z
  .string()
  .min(2)
  .max(256)
  .regex(/^(\/[a-z0-9][a-z0-9-]*)+$/, "paths are /segment/segment with kebab-case segments");
