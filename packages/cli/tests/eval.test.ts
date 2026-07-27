import { describe, expect, it } from "vitest";

import {
  EVAL_REPORT_VERSION,
  buildEvalArtifact,
  createScenarioReport,
  type ScenarioReport,
} from "../src/eval";
import { SCENARIOS } from "../../../scenarios";

describe("eval report corpus semantics", () => {
  it("maps the validated corpus taxonomy independently from BLOCK expectations", () => {
    const reports: ScenarioReport[] = SCENARIOS.map(({ expectations }) => {
      const report = createScenarioReport(expectations, 1);
      report.outcomes.accepted = 1;
      if (report.expectsBlock) report.blocked = 1;
      else report.clean = 1;
      return report;
    });

    expect(reports).toHaveLength(9);
    expect(reports.filter(({ adversarial }) => adversarial)).toHaveLength(6);
    expect(reports.filter(({ expectsBlock }) => expectsBlock)).toHaveLength(5);
    expect(
      reports.find(({ scenarioId }) => scenarioId === "scenario-g-silent-regression"),
    ).toMatchObject({
      adversarial: true,
      expectsBlock: false,
    });

    const artifact = buildEvalArtifact(
      reports,
      { provider: "Test provider", model: "test-model" },
      {
        directory: "scenarios",
        generatedAtUtc: "2026-07-27T00:00:00.000Z",
        runsPerScenario: 1,
      },
    );

    expect(EVAL_REPORT_VERSION).toBe(2);
    expect(artifact.corpus).toEqual({
      directory: "scenarios",
      scenarios: 9,
      adversarial: 6,
      runsPerScenario: 1,
    });
    expect(artifact.summary.redTeamBlockedPct).toBe(100);
  });
});
