import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { captureFixture, defaultProvider, resolveModel } from "@changesafe/ai";
import { evaluatePolicies } from "@changesafe/core";
import { networkDomain } from "@changesafe/domain-network";
import { analyzeLive } from "@/lib/ai/live";
import { getScenario } from "@/scenarios";

/**
 * Optional live smoke test. Spends real API credit and requires network plus
 * a configured provider, so it only runs when CHANGESAFE_LIVE_SMOKE=1 is set
 * explicitly. Set CHANGESAFE_PROVIDER to choose which provider to exercise.
 *
 * With CHANGESAFE_CAPTURE_FIXTURE=1 it additionally writes a
 * provenance-stamped capture the owner can review and promote to the bundled
 * replay fixture for scenario A.
 */
const liveEnabled = process.env.CHANGESAFE_LIVE_SMOKE === "1";

describe.skipIf(!liveEnabled)("live provider smoke (opt-in)", () => {
  it("produces a schema-valid, evidence-grounded proposal for scenario A", async () => {
    const scenario = getScenario("scenario-a-failover");
    if (!scenario) throw new Error("scenario A missing");

    const provider = defaultProvider(process.env);
    if (!provider) throw new Error("no provider configured; set CHANGESAFE_PROVIDER or a key");

    const { proposal, model } = await analyzeLive(scenario.input as never);
    // The provider reports what answered; assert only that it is a real
    // answer, since a provider may resolve an alias to a dated snapshot.
    expect(model).toBeTruthy();
    expect(model.length).toBeGreaterThan(0);
    expect(proposal.operations.length).toBeGreaterThan(0);

    // The deterministic gate must run cleanly on live output too.
    const { findings } = evaluatePolicies(networkDomain, scenario.input as never, proposal);
    expect(findings).toHaveLength(7);

    if (process.env.CHANGESAFE_CAPTURE_FIXTURE === "1") {
      const capture = captureFixture(
        { proposal, provider: provider.id, model },
        {
          scenarioId: "scenario-a-failover",
          fixtureId: "fix-a-failover-captured",
          capturedAtUtc: new Date().toISOString(),
          notes: `Captured from a real ${provider.label} call (requested ${resolveModel(provider, process.env)}) by the opt-in live smoke test. Review before promoting to replay-fixture.json.`,
        },
      );
      const outDir = path.join(process.cwd(), "scenarios", "network", "scenario-a-failover");
      mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, "replay-fixture.captured.json");
      writeFileSync(outPath, `${JSON.stringify(capture, null, 2)}\n`);
      console.log(`captured fixture written to ${outPath}`);
    }
  }, 120_000);
});
