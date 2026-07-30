import { describe, expect, it } from "vitest";
import { resolveInitialScenarioId } from "../../components/hooks/useScenarioDeepLink";

describe("resolveInitialScenarioId", () => {
  it("returns the id when the scenario query param matches an available id", () => {
    const params = new URLSearchParams("scenario=scenario-b-route-leak");
    const result = resolveInitialScenarioId(params, [
      "scenario-a-failover",
      "scenario-b-route-leak",
    ]);
    expect(result).toBe("scenario-b-route-leak");
  });

  it("returns null when there is no scenario query param", () => {
    const params = new URLSearchParams("");
    const result = resolveInitialScenarioId(params, ["scenario-a-failover"]);
    expect(result).toBeNull();
  });

  it("returns null when the scenario query param doesn't match any available id", () => {
    const params = new URLSearchParams("scenario=does-not-exist");
    const result = resolveInitialScenarioId(params, ["scenario-a-failover"]);
    expect(result).toBeNull();
  });

  it("returns null when searchParams itself is null", () => {
    const result = resolveInitialScenarioId(null, ["scenario-a-failover"]);
    expect(result).toBeNull();
  });
});
