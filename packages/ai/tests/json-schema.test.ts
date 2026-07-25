import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toPortableJsonSchema } from "../src/json-schema";
import { networkAnalysisPrompt } from "../src/prompts/network";

type Node = Record<string, unknown>;

function isRecord(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walk only genuine schema nodes, skipping the keys of `properties` maps. */
function walkSchemas(node: unknown, visit: (schema: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkSchemas(item, visit);
    return;
  }
  if (!isRecord(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "$defs" || key === "definitions") {
      if (isRecord(value)) for (const child of Object.values(value)) walkSchemas(child, visit);
      continue;
    }
    if (key === "anyOf" || key === "oneOf" || key === "allOf" || key === "items") {
      walkSchemas(value, visit);
    }
  }
}

const portable = toPortableJsonSchema(networkAnalysisPrompt.proposalSchema);

describe("toPortableJsonSchema", () => {
  it("drops the keywords providers disagree about", () => {
    const forbidden = [
      "minLength",
      "maxLength",
      "pattern",
      "minItems",
      "maxItems",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      "$schema",
    ];
    walkSchemas(portable, (schema) => {
      for (const keyword of forbidden) {
        expect(schema, `unexpected ${keyword}`).not.toHaveProperty(keyword);
      }
    });
  });

  it("closes every object and requires every property", () => {
    walkSchemas(portable, (schema) => {
      if (schema.type !== "object") return;
      expect(schema.additionalProperties).toBe(false);
      const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
      expect(schema.required).toEqual(properties);
    });
  });

  it("restates dropped constraints as guidance instead of losing them", () => {
    const confidence = (
      (portable.properties as Node).diagnosis as Node
    ).properties as Node;
    // 0..1 is gone from the wire schema, so the model is told in prose.
    expect((confidence.confidence as Node).description).toContain("0 or greater");
    expect((confidence.confidence as Node).description).toContain("1 or less");
  });

  it("keeps the structure a provider needs to constrain generation", () => {
    expect(portable.type).toBe("object");
    const properties = portable.properties as Node;
    expect(Object.keys(properties)).toContain("operations");
    const operations = properties.operations as Node;
    expect(operations.type).toBe("array");
    const op = (operations.items as Node).properties as Node;
    expect((op.op as Node).enum).toEqual(["add", "replace", "remove"]);
  });

  it("does not mistake a property named like a keyword for a constraint", () => {
    // A route has a `description` field, and JSON Schema uses `description`
    // as an annotation — the walker must not conflate the two.
    const schema = toPortableJsonSchema(
      z.strictObject({
        pattern: z.string(),
        minimum: z.number(),
        description: z.string(),
      }),
    );
    const properties = schema.properties as Node;
    expect(Object.keys(properties).sort()).toEqual(["description", "minimum", "pattern"]);
    expect((properties.pattern as Node).type).toBe("string");
    expect((properties.minimum as Node).type).toBe("number");
  });

  it("still enforces the dropped constraints locally", () => {
    // The wire schema no longer bounds confidence, so the Zod schema must —
    // this is what makes dropping the keyword safe.
    const result = networkAnalysisPrompt.proposalSchema.safeParse({
      proposalId: "prop-x",
      summary: "x",
      diagnosis: { likelyCause: "x", confidence: 42, evidenceIds: ["ev-a"], assumptions: [] },
      operations: [],
      rollbackOperations: [],
      verificationSteps: [],
    });
    expect(result.success).toBe(false);
  });
});
