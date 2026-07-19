import { describe, expect, it } from "vitest";

import { runSimulation } from "@/lib/patch/simulate";
import { canonicalize } from "@/lib/receipt/canonical";
import { buildIncidentBundle, buildOperation, buildProposal } from "@/tests/helpers/fixtures";

describe("runSimulation", () => {
  it("applies the patch to a sandboxed copy and reports satisfied safety properties", () => {
    const bundle = buildIncidentBundle();
    const result = runSimulation(bundle, buildProposal());

    expect(result.status).toBe("completed");
    expect(result.changedResourceIds).toContain("device:edge-rtr-01");
    expect(result.diff).toHaveLength(1);
    expect(result.safetyProperties.every((property) => property.satisfied)).toBe(true);
    expect(result.summary).toContain("No real infrastructure was contacted");
  });

  it("never mutates the canonical bundle state", () => {
    const bundle = buildIncidentBundle();
    const fingerprint = canonicalize(bundle.currentState);
    runSimulation(bundle, buildProposal());
    expect(canonicalize(bundle.currentState)).toBe(fingerprint);
  });

  it("reports violated safety properties honestly", () => {
    const bundle = buildIncidentBundle();
    const result = runSimulation(
      bundle,
      buildProposal({
        operations: [
          buildOperation({
            op: "remove",
            path: "/devices/edge-rtr-01/routes/rt-mgmt",
            value: null,
          }),
        ],
      }),
    );
    const routeProperty = result.safetyProperties.find(
      (property) => property.propertyId === "sp-mgmt-route",
    );
    expect(routeProperty?.satisfied).toBe(false);
  });
});
