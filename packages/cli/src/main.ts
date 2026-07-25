import { parseArgs } from "node:util";

import { PROVIDER_IDS } from "@changesafe/ai";
import { isDomainError } from "@changesafe/core";

import { runAnalyze } from "./analyze";
import { DOMAIN_IDS } from "./domains";
import { runEval } from "./eval";
import { runGate } from "./gate";
import { UsageError } from "./io";
import { runScenarioCheck, runScenarioInit } from "./scenario";
import { runVerify } from "./verify";
import { EXIT_USAGE, createConsole, paint, type Console } from "./output";

const HELP = `changesafe — a deterministic airlock for AI-proposed infrastructure changes

USAGE
  changesafe gate      [options]        evaluate a proposal against the safety gate
  changesafe analyze   [options]        ask a model for a proposal, then gate it
  changesafe eval      [options]        measure a model against the scenario suite
  changesafe verify    <receipt.json>   recompute a receipt's hashes
  changesafe scenario  check [dir]      check scenarios against their expectations
  changesafe scenario  init <name>      scaffold a new scenario

GATE OPTIONS
  --input <file>        the analyzed input: an incident bundle, or
                        \`terraform show -json\` output for --domain terraform
  --proposal <file>     a proposal, or a replay fixture containing one
                        (the terraform domain derives this from the plan)
  --scenario <dir>      shorthand for --input <dir>/incident.json
                        and --proposal <dir>/replay-fixture.json
  --context <file>      untrusted text that came with the change (a PR body),
                        scanned for injected instructions
  --domain <id>         domain to gate against (default: network; available: ${DOMAIN_IDS.join(", ")})
  --policy-pack <file>  typed threshold overrides
  --receipt <file>      write a hashed receipt of this evaluation
  --source-id <id>      what to record as the input's origin
  --format pretty|json  output format (default: pretty)

ANALYZE OPTIONS
  --input <file>        the incident bundle to analyze
  --scenario <dir>      shorthand for --input <dir>/incident.json
  --provider <id>       ${PROVIDER_IDS.join(" | ")} (default: the configured one)
  --model <id>          override the provider's default model
  --out <file>          write the accepted proposal
  --capture <file>      write a provenance-stamped replay fixture
  plus every GATE OPTION above, applied to the resulting proposal

EVAL OPTIONS
  --provider <id>       required; spends API credit
  --model <id>          override the provider's default model
  --dir <dir>           scenario suite (default: scenarios)
  --runs <n>            attempts per scenario (default: 1, max 20)
  --format pretty|json

VERIFY OPTIONS
  --input <file>        also check the receipt describes this input
  --proposal <file>     also check the receipt describes this proposal
  --format pretty|json

EXIT CODES
  0  evaluated, nothing blocking      1  evaluated, blocked      2  could not evaluate

No command approves a change, and there is no --auto-approve. A clean gate is
an input to a human decision, not a substitute for one. Only \`analyze\` and
\`eval\` call a model; the gate itself never does.`;

const OPTION_SPEC = {
  input: { type: "string" },
  proposal: { type: "string" },
  scenario: { type: "string" },
  domain: { type: "string", default: "network" },
  "policy-pack": { type: "string" },
  receipt: { type: "string" },
  "source-id": { type: "string" },
  context: { type: "string" },
  provider: { type: "string" },
  model: { type: "string" },
  out: { type: "string" },
  capture: { type: "string" },
  runs: { type: "string", default: "1" },
  format: { type: "string", default: "pretty" },
  dir: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", default: false },
} as const;

function parseFormat(value: string): "pretty" | "json" {
  if (value !== "pretty" && value !== "json") {
    throw new UsageError(`--format must be "pretty" or "json", got "${value}"`);
  }
  return value;
}

export async function main(argv: string[], console: Console): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "invalid arguments");
  }

  const { values, positionals } = parsed;

  if (values.version) {
    console.out("changesafe 0.1.0");
    return 0;
  }
  if (values.help || positionals.length === 0) {
    console.out(HELP);
    return positionals.length === 0 && !values.help ? EXIT_USAGE : 0;
  }

  const format = parseFormat(values.format);
  const command = positionals[0];

  switch (command) {
    case "gate":
      return runGate(
        {
          domain: values.domain,
          input: values.input,
          proposal: values.proposal,
          scenario: values.scenario,
          policyPack: values["policy-pack"],
          receipt: values.receipt,
          sourceId: values["source-id"],
          context: values.context,
          format,
        },
        console,
      );

    case "analyze":
      return runAnalyze(
        {
          domain: values.domain,
          input: values.input,
          scenario: values.scenario,
          provider: values.provider,
          model: values.model,
          out: values.out,
          capture: values.capture,
          policyPack: values["policy-pack"],
          receipt: values.receipt,
          sourceId: values["source-id"],
          format,
        },
        console,
      );

    case "eval": {
      if (!values.provider) {
        throw new UsageError(
          `eval needs an explicit --provider (${PROVIDER_IDS.join(", ")}) because it spends API credit`,
        );
      }
      const runs = Number(values.runs);
      if (!Number.isFinite(runs)) throw new UsageError(`--runs must be a number, got "${values.runs}"`);
      return runEval(
        {
          provider: values.provider,
          model: values.model,
          dir: values.dir ?? "scenarios",
          runs,
          format,
        },
        console,
      );
    }

    case "verify": {
      const receipt = positionals[1] ?? values.receipt;
      if (!receipt) throw new UsageError("verify needs a receipt file: changesafe verify <receipt.json>");
      return runVerify(
        {
          receipt,
          input: values.input,
          proposal: values.proposal,
          domain: values.domain,
          format,
        },
        console,
      );
    }

    case "scenario": {
      const sub = positionals[1];
      if (sub === "check") {
        return runScenarioCheck(
          { dir: positionals[2] ?? values.dir ?? "scenarios", domain: values.domain, format },
          console,
        );
      }
      if (sub === "init") {
        const name = positionals[2];
        if (!name) throw new UsageError("scenario init needs a name: changesafe scenario init <name>");
        return runScenarioInit({ name, dir: values.dir ?? "scenarios" }, console);
      }
      throw new UsageError(`unknown scenario subcommand "${sub ?? ""}". Use check or init.`);
    }

    default:
      throw new UsageError(`unknown command "${command}". Run changesafe --help.`);
  }
}

/** Entry point: turns thrown usage errors into exit code 2 with a clear message. */
export async function run(argv: string[]): Promise<number> {
  const console = createConsole();
  try {
    return await main(argv, console);
  } catch (error) {
    // Typed domain errors carry a message written for a person; the raw
    // `message` prefixes it with an internal code.
    const message = isDomainError(error)
      ? error.userMessage
      : error instanceof Error
        ? error.message
        : "the gate failed for an unknown reason";
    console.err("");
    console.err(`  ${paint(console.color, "red", "error")} ${message}`);
    console.err("");
    return EXIT_USAGE;
  }
}

// Bundled binaries run immediately; importing this module for tests does not.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv.slice(2));
}
