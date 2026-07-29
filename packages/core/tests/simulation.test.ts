import { describe, expect, it } from "vitest";

import { SimulationResultSchema } from "../src/simulation";

function simulationResultWithEntries(count: number) {
  return {
    status: "completed" as const,
    changedResourceIds: Array.from({ length: count }, (_, index) => `resource-${index}`),
    diff: Array.from({ length: count }, (_, index) => ({
      op: "replace" as const,
      path: `/resources/resource-${index}`,
      before: index,
      after: index + 1,
    })),
    safetyProperties: [],
    summary: "A bounded sandbox simulation completed.",
  };
}

describe("SimulationResultSchema", () => {
  it("accepts a simulation result for a 5,000-operation proposal", () => {
    expect(
      SimulationResultSchema.safeParse(simulationResultWithEntries(5_000)).success,
    ).toBe(true);
  });

  it("rejects a simulation result that exceeds the 5,000-operation safety bound", () => {
    expect(
      SimulationResultSchema.safeParse(simulationResultWithEntries(5_001)).success,
    ).toBe(false);
  });
});
