import { mkdirSync, writeFileSync } from "node:fs";
import { networkDomain } from "@changesafe/domain-network";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeLive } from "@/lib/ai/live";
import { ReplayFixtureSchema } from "@changesafe/core";
import { evaluatePolicies } from "@changesafe/core";
import { RUNTIME_MODEL } from "@/lib/domain/version";
import { getScenario } from "@/scenarios";

/**
 * Optional live smoke test. Spends real API credit and requires network +
 * OPENAI_API_KEY, so it only runs when CHANGESAFE_LIVE_SMOKE=1 is set
 * explicitly. With CHANGESAFE_CAPTURE_FIXTURE=1 it additionally writes a
 * provenance-stamped capture the owner can review and promote to the bundled
 * replay fixture for scenario A.
 */
const liveEnabled = process.env.CHANGESAFE_LIVE_SMOKE === "1";

describe.skipIf(!liveEnabled)("live GPT-5.6 smoke (opt-in)", () => {
  it("produces a schema-valid, evidence-grounded proposal for scenario A", async () => {
    const scenario = getScenario("scenario-a-failover");
    if (!scenario) throw new Error("scenario A missing");

    const { proposal, model } = await analyzeLive(scenario.bundle);
    expect(model).toBe(RUNTIME_MODEL);
    expect(proposal.operations.length).toBeGreaterThan(0);

    // The deterministic gate must run cleanly on live output too.
    const { findings } = evaluatePolicies(networkDomain, scenario.bundle, proposal);
    expect(findings).toHaveLength(7);

    if (process.env.CHANGESAFE_CAPTURE_FIXTURE === "1") {
      const capture = ReplayFixtureSchema.parse({
        fixtureId: "fix-a-failover-captured",
        scenarioId: "scenario-a-failover",
        provenance: "captured_gpt_5_6",
        model,
        capturedAtUtc: new Date().toISOString(),
        notes:
          "Captured from a real GPT-5.6 Responses API call by the opt-in live smoke test. Review before promoting to replay-fixture.json.",
        proposal,
      });
      const outDir = path.join(process.cwd(), "scenarios", "scenario-a-failover");
      mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, "replay-fixture.captured.json");
      writeFileSync(outPath, `${JSON.stringify(capture, null, 2)}\n`);
      console.log(`captured fixture written to ${outPath}`);
    }
  }, 120_000);
});
