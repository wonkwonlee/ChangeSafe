import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  networkAnalysisPrompt,
  probeProposal,
  resolveModel,
  resolveProvider,
  type ProposalVerdict,
} from "@changesafe/ai";
import {
  ScenarioExpectationsSchema,
  evaluatePolicies,
  hasBlockingFinding,
  type ChangeProposal,
} from "@changesafe/core";
import { IncidentBundleSchema, networkDomain } from "@changesafe/domain-network";

import { UsageError, parseOrThrow, readJsonFile } from "./io";
import { EXIT_OK, paint, type Console } from "./output";

export interface EvalOptions {
  provider: string;
  model?: string;
  dir: string;
  runs: number;
  format: "pretty" | "json";
}

type Outcome = ProposalVerdict["outcome"];

interface ScenarioReport {
  scenarioId: string;
  /** Whether the scenario's declared expectations include a BLOCK. */
  expectsBlock: boolean;
  attempts: number;
  outcomes: Record<Outcome, number>;
  /** Gate verdicts for the attempts that produced an accepted proposal. */
  blocked: number;
  clean: number;
  notes: string[];
}

const EMPTY_OUTCOMES: Record<Outcome, number> = {
  accepted: 0,
  call_failed: 0,
  no_output: 0,
  schema_invalid: 0,
  ungrounded: 0,
};

/**
 * Measure a model against the bundled scenarios.
 *
 * This answers "how good is this model at proposing", never "how safe is this
 * model". Safety is not a model property here: every proposal below is judged
 * by the same deterministic gate regardless of who wrote it, so a weaker
 * model produces more rejections and more blocks, never a weaker verdict.
 *
 * Spends real API credit and requires an explicitly chosen provider. No
 * default, and nothing in CI runs it.
 */
export async function runEval(options: EvalOptions, console: Console): Promise<number> {
  const provider = resolveProvider(options.provider);
  if (!provider.isConfigured(process.env)) {
    throw new UsageError(
      provider.credentialEnvVar
        ? `${provider.label} needs ${provider.credentialEnvVar} to be set`
        : `${provider.label} is not available`,
    );
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 20) {
    throw new UsageError("--runs must be an integer between 1 and 20");
  }

  const root = path.resolve(options.dir);
  if (!existsSync(root)) throw new UsageError(`scenario directory does not exist: ${root}`);

  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(root, name, "expectations.json")))
    .sort();
  if (directories.length === 0) throw new UsageError(`no scenarios found in ${root}`);

  const model = resolveModel(provider, process.env, options.model);

  if (options.format === "pretty") {
    console.err(
      `  ${paint(console.color, "dim", `evaluating ${provider.label} ${model} over ${directories.length} scenarios × ${options.runs} run(s) — this spends API credit`)}`,
    );
  }

  const reports: ScenarioReport[] = [];
  for (const name of directories) {
    reports.push(await evaluateScenario(path.join(root, name), provider.id, model, options.runs));
  }

  return report(reports, { provider: provider.label, model }, options, console);
}

async function evaluateScenario(
  dir: string,
  providerId: string,
  model: string,
  runs: number,
): Promise<ScenarioReport> {
  const bundle = parseOrThrow(
    IncidentBundleSchema,
    readJsonFile(path.join(dir, "incident.json"), "incident bundle"),
    "incident bundle",
  );
  const expectations = parseOrThrow(
    ScenarioExpectationsSchema,
    readJsonFile(path.join(dir, "expectations.json"), "expectations"),
    "expectations",
  );
  const expectsBlock = Object.values(expectations.policies).includes("BLOCK");

  const report: ScenarioReport = {
    scenarioId: expectations.scenarioId,
    expectsBlock,
    attempts: runs,
    outcomes: { ...EMPTY_OUTCOMES },
    blocked: 0,
    clean: 0,
    notes: [],
  };

  for (let run = 0; run < runs; run += 1) {
    const verdict = await probeProposal(networkAnalysisPrompt, bundle, {
      provider: resolveProvider(providerId),
      model,
    });
    report.outcomes[verdict.outcome] += 1;

    if (verdict.outcome === "accepted") {
      const { findings } = evaluatePolicies(
        networkDomain,
        bundle,
        verdict.proposal as ChangeProposal,
      );
      if (hasBlockingFinding(findings)) report.blocked += 1;
      else report.clean += 1;
    } else if (report.notes.length < 3) {
      report.notes.push(`${verdict.outcome}: ${"detail" in verdict ? verdict.detail : ""}`.trim());
    }
  }

  return report;
}

function report(
  reports: ScenarioReport[],
  target: { provider: string; model: string },
  options: EvalOptions,
  console: Console,
): number {
  const total = (pick: (r: ScenarioReport) => number) => reports.reduce((sum, r) => sum + pick(r), 0);

  const attempts = total((r) => r.attempts);
  const callFailed = total((r) => r.outcomes.call_failed);
  // A transport failure says nothing about the model, so it is excluded from
  // every rate rather than silently counted as a model error.
  const answered = attempts - callFailed;
  const accepted = total((r) => r.outcomes.accepted);
  const ungrounded = total((r) => r.outcomes.ungrounded);
  const schemaValid = accepted + ungrounded;

  const redTeam = reports.filter((r) => r.expectsBlock);
  const redTeamAccepted = redTeam.reduce((sum, r) => sum + r.outcomes.accepted, 0);
  const redTeamBlocked = redTeam.reduce((sum, r) => sum + r.blocked, 0);

  const rate = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

  const summary = {
    provider: target.provider,
    model: target.model,
    attempts,
    answered,
    callFailed,
    schemaValidPct: rate(schemaValid, answered),
    evidenceGroundedPct: rate(accepted, answered),
    redTeamBlockedPct: rate(redTeamBlocked, redTeamAccepted),
  };

  if (options.format === "json") {
    console.out(JSON.stringify({ summary, scenarios: reports }, null, 2));
    return EXIT_OK;
  }

  const pct = (value: number | null) => (value === null ? "n/a" : `${value.toFixed(1)}%`);

  console.out("");
  console.out(
    `  ${paint(console.color, "bold", "ChangeSafe eval")} ${paint(console.color, "dim", `· ${target.provider} · ${target.model}`)}`,
  );
  console.out("");
  for (const scenario of reports) {
    const tag = scenario.expectsBlock
      ? paint(console.color, "dim", "expects BLOCK")
      : paint(console.color, "dim", "expects clean");
    console.out(`  ${scenario.scenarioId.padEnd(30)} ${tag}`);
    console.out(
      `    ${paint(console.color, "dim", `accepted ${scenario.outcomes.accepted}/${scenario.attempts} · gate: ${scenario.blocked} blocked, ${scenario.clean} clean`)}`,
    );
    for (const note of scenario.notes) {
      console.out(`    ${paint(console.color, "dim", `· ${note}`)}`);
    }
  }

  console.out("");
  console.out(`  schema-valid       ${pct(summary.schemaValidPct)}  (of ${answered} answered)`);
  console.out(`  evidence-grounded  ${pct(summary.evidenceGroundedPct)}  (of ${answered} answered)`);
  console.out(
    `  red-team blocked   ${pct(summary.redTeamBlockedPct)}  (of ${redTeamAccepted} accepted on block-expected scenarios)`,
  );
  if (callFailed > 0) {
    console.out(
      `  ${paint(console.color, "dim", `${callFailed} call(s) failed and are excluded from every rate`)}`,
    );
  }
  console.out("");
  console.out(
    `  ${paint(console.color, "dim", "Read these as proposal quality, not safety. A low red-team block rate means")}`,
  );
  console.out(
    `  ${paint(console.color, "dim", "the model resisted the injected instruction; a high one means it did not and")}`,
  );
  console.out(
    `  ${paint(console.color, "dim", "the gate caught it. Neither number changes what the gate blocks.")}`,
  );
  console.out("");

  // Reporting always succeeds: a bad model score is a finding, not a failure.
  return EXIT_OK;
}
