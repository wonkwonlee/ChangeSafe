import { describe, expect, it } from "vitest";

import { ReplayFixtureSchema } from "@changesafe/core";

import { captureFixture } from "../src/capture";
import { loadProposal } from "./helpers";

const proposal = loadProposal();
const capturedAtUtc = "2026-07-25T10:04:59.625Z";

describe("captureFixture", () => {
  it("stamps a real capture with the model and time that produced it", () => {
    const fixture = captureFixture(
      { proposal, provider: "anthropic", model: "claude-opus-4-8" },
      { scenarioId: "scenario-a-failover", capturedAtUtc },
    );

    expect(fixture.provenance).toBe("captured");
    expect(fixture.model).toBe("claude-opus-4-8");
    expect(fixture.capturedAtUtc).toBe(capturedAtUtc);
    expect(fixture.proposal).toEqual(proposal);
    // The written file must satisfy the same schema the loader enforces.
    expect(ReplayFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it("names the provider in the fixture id so captures do not collide", () => {
    const openai = captureFixture(
      { proposal, provider: "openai", model: "gpt-5.6" },
      { scenarioId: "scenario-a-failover", capturedAtUtc },
    );
    const ollama = captureFixture(
      { proposal, provider: "ollama", model: "llama3.1" },
      { scenarioId: "scenario-a-failover", capturedAtUtc },
    );
    expect(openai.fixtureId).not.toBe(ollama.fixtureId);
  });

  it("records provenance for any provider, not just one vendor", () => {
    for (const [provider, model] of [
      ["openai", "gpt-5.6"],
      ["anthropic", "claude-opus-4-8"],
      ["ollama", "llama3.1"],
    ] as const) {
      const fixture = captureFixture(
        { proposal, provider, model },
        { scenarioId: "scenario-a-failover", capturedAtUtc },
      );
      expect(fixture.provenance).toBe("captured");
      expect(fixture.model).toBe(model);
    }
  });

  it("refuses to write a fixture whose scenario id is not a valid identifier", () => {
    expect(() =>
      captureFixture(
        { proposal, provider: "openai", model: "gpt-5.6" },
        { scenarioId: "Not A Valid Id", capturedAtUtc },
      ),
    ).toThrowError(/could not be written as a replay fixture/);
  });

  it("cannot be used to launder an authored proposal as model output", () => {
    // The only way to get `captured` is through this function, and it always
    // attaches the answering model — a hand-written file claiming `captured`
    // with model: null is rejected by the schema.
    const forged = {
      fixtureId: "fix-forged",
      scenarioId: "scenario-a-failover",
      provenance: "captured",
      model: null,
      capturedAtUtc: null,
      notes: "hand-written but claiming a capture",
      proposal,
    };
    expect(ReplayFixtureSchema.safeParse(forged).success).toBe(false);
  });
});
