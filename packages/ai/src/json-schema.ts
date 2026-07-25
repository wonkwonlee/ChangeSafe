import { z } from "zod";

/**
 * One Zod schema, three providers.
 *
 * Every provider's structured-output mode accepts JSON Schema, but each
 * accepts a different subset. Rather than hand-maintain three schemas — which
 * would let them drift apart, and let one provider be validated more loosely
 * than another — we derive all of them from the same Zod schema and reduce it
 * to the intersection every provider honors.
 *
 * Dropping a constraint from the wire schema does not drop it from the gate:
 * the returned object is parsed by the full Zod schema afterwards, so a model
 * that violates a stripped constraint is rejected locally. The wire schema
 * shapes the output; Zod decides whether it is acceptable.
 */

export type JsonSchema = Record<string, unknown>;

/**
 * Validation keywords providers disagree about. They are removed from the
 * wire schema and restated in `description` so the model still sees the
 * requirement as guidance — losing the constraint entirely measurably
 * degrades output quality.
 */
const CONSTRAINT_PHRASES: Record<string, (value: unknown) => string> = {
  minLength: (v) => `at least ${String(v)} characters`,
  maxLength: (v) => `at most ${String(v)} characters`,
  pattern: (v) => `matching the regular expression ${String(v)}`,
  minItems: (v) => `at least ${String(v)} items`,
  maxItems: (v) => `at most ${String(v)} items`,
  minimum: (v) => `${String(v)} or greater`,
  maximum: (v) => `${String(v)} or less`,
  exclusiveMinimum: (v) => `greater than ${String(v)}`,
  exclusiveMaximum: (v) => `less than ${String(v)}`,
  multipleOf: (v) => `a multiple of ${String(v)}`,
};

/** Keys whose values are maps of name → schema. Their keys are author-chosen
 *  names, never keywords, so keyword rules must not apply inside them. */
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions", "patternProperties"]);
/** Keys whose values are arrays of schemas. */
const SCHEMA_LISTS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);
/** Keys whose values are a single nested schema. */
const SCHEMA_VALUES = new Set(["items", "not", "contains", "additionalItems", "propertyNames"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function portableNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(portableNode);
  if (!isRecord(node)) return node;

  const out: Record<string, unknown> = {};
  const stripped: string[] = [];

  for (const [key, value] of Object.entries(node)) {
    // Draft declarations are meaningless to a provider and rejected by some.
    if (key === "$schema") continue;

    if (SCHEMA_MAPS.has(key) && isRecord(value)) {
      const mapped: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value)) {
        mapped[name] = portableNode(child);
      }
      out[key] = mapped;
      continue;
    }
    if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      out[key] = value.map(portableNode);
      continue;
    }
    if (SCHEMA_VALUES.has(key)) {
      out[key] = portableNode(value);
      continue;
    }

    const phrase = CONSTRAINT_PHRASES[key];
    if (phrase) {
      stripped.push(phrase(value));
      continue;
    }

    out[key] = value;
  }

  if (out.type === "object") {
    // Strict structured output requires a closed object whose `required`
    // names every property. Optional fields must be modeled as nullable.
    out.additionalProperties = false;
    if (isRecord(out.properties)) {
      out.required = Object.keys(out.properties);
    }
  }

  if (stripped.length > 0) {
    const existing = typeof out.description === "string" ? `${out.description} ` : "";
    out.description = `${existing}Must be ${stripped.join(", ")}.`;
  }

  return out;
}

/**
 * Reduce a Zod schema to the JSON Schema subset every supported provider
 * accepts in strict structured-output mode.
 */
export function toPortableJsonSchema(schema: z.ZodType): JsonSchema {
  const generated = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
  const portable = portableNode(generated);
  if (!isRecord(portable)) {
    // z.toJSONSchema always yields an object for object schemas; this guards
    // a future scalar schema rather than silently shipping a non-schema.
    throw new TypeError("a portable JSON Schema must be an object schema");
  }
  return portable;
}
