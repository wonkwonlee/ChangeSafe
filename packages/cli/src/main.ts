import { parseArgs } from "node:util";

import { PROVIDER_IDS } from "@changesafe/ai";
import { isDomainError } from "@changesafe/core";

import { runAnalyze } from "./analyze";
import { DOMAIN_IDS } from "./domains";
import { runEval } from "./eval";
import { runGallery } from "./gallery";
import { runGate } from "./gate";
import { UsageError } from "./io";
import { runKeygen } from "./keygen";
import { runLedgerAppend, runLedgerList, runLedgerVerify } from "./ledger";
import { runScenarioCheck, runScenarioInit } from "./scenario";
import { runServe } from "./serve";
import { runVerify } from "./verify";
import { EXIT_USAGE, createConsole, paint, type Console } from "./output";

const HELP = `changesafe — a deterministic airlock for AI-proposed infrastructure changes

USAGE
  changesafe gate      [options]        evaluate a proposal against the safety gate
  changesafe analyze   [options]        ask a model for a proposal, then gate it
  changesafe eval      [options]        measure a model against the scenario suite
  changesafe verify    <receipt.json>   recompute a receipt's hashes and signature
  changesafe keygen    [--out <path>]   generate an Ed25519 receipt signing key
  changesafe ledger    append|list|verify   append-only decision ledger
  changesafe serve     [options]        authenticated self-hosted decision API
  changesafe scenario  check [dir]      check scenarios against their expectations
  changesafe scenario  init <name>      scaffold a new scenario
  changesafe scenario  gallery          regenerate the scenario gallery

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
  --sign-key <file>     private-key PEM; signs the receipt it writes
  --receipt-id <id>     fix receipt identity for audited snapshot generation
  --created-at <UTC>    fix receipt and signature time for audited snapshots
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
  --report <file>       write a versioned, committable report
  --format pretty|json

LEDGER OPTIONS
  --db <file>           ledger database (default: changesafe-ledger.db)
  --source-id <id>      list: only this source
  --decision <kind>     list: only approved|rejected|blocked|gate_only
  --limit <n>           list: how many entries (default 50)

\`ledger verify\` recomputes the hash chain and exits 1 on any break: an entry
that was altered, removed, or reordered. Append-only is enforced by database
triggers; the chain is what catches someone who owns the file.

SERVE OPTIONS (self-hosting)
  --db <file>           append-only ledger (default: changesafe-ledger.db)
  --host <host>         bind address (default: 127.0.0.1)
  --port <n>            port (default: 8787)
  --oidc-issuer <url>   required; approver tokens must come from this issuer
  --oidc-audience <id>  required; tokens must be minted for this audience
  --oidc-jwks-uri <url> skip discovery and use this key endpoint
  --sign-key <file>     sign every receipt this API issues

The API recomputes findings itself rather than trusting the caller, records an
authenticated approver on every decision, and appends to the ledger before
answering. It has no execution endpoint and no anonymous mode.

VERIFY OPTIONS
  --input <file>        also check the receipt describes this input
  --proposal <file>     also check the receipt describes this proposal
  --public-key <file>   trusted key, obtained out of band, to check a signature
  --skip-signature      report integrity only, leaving authorship unchecked
  --format pretty|json

Hashes prove a receipt was not altered. Only a signature proves who issued it,
and only against a key you already trust — so verifying a signed receipt
without --public-key exits 2 rather than pretending to have checked it.

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
  "sign-key": { type: "string" },
  "receipt-id": { type: "string" },
  "created-at": { type: "string" },
  "public-key": { type: "string" },
  "skip-signature": { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  check: { type: "boolean", default: false },
  report: { type: "string" },
  db: { type: "string" },
  host: { type: "string" },
  port: { type: "string" },
  "oidc-issuer": { type: "string" },
  "oidc-audience": { type: "string" },
  "oidc-jwks-uri": { type: "string" },
  decision: { type: "string" },
  limit: { type: "string" },
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
          signKey: values["sign-key"],
          receiptId: values["receipt-id"],
          now: values["created-at"],
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
          signKey: values["sign-key"],
          receiptId: values["receipt-id"],
          receiptCreatedAtUtc: values["created-at"],
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
          report: values.report,
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
          publicKey: values["public-key"],
          skipSignature: values["skip-signature"],
          domain: values.domain,
          format,
        },
        console,
      );
    }

    case "keygen":
      return runKeygen(
        { out: values.out ?? "changesafe-signing-key", force: values.force, format },
        console,
      );

    case "serve": {
      const port = Number(values.port ?? "8787");
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new UsageError(`--port must be a port number, got "${values.port}"`);
      }
      return runServe(
        {
          db: values.db ?? "changesafe-ledger.db",
          host: values.host ?? "127.0.0.1",
          port,
          oidcIssuer: values["oidc-issuer"],
          oidcAudience: values["oidc-audience"],
          oidcJwksUri: values["oidc-jwks-uri"],
          signKey: values["sign-key"],
        },
        console,
      );
    }

    case "ledger": {
      const sub = positionals[1];
      const db = values.db ?? "changesafe-ledger.db";
      const limit = values.limit === undefined ? undefined : Number(values.limit);
      if (limit !== undefined && !Number.isFinite(limit)) {
        throw new UsageError(`--limit must be a number, got "${values.limit}"`);
      }
      const ledgerOptions = {
        db,
        receipt: positionals[2] ?? values.receipt,
        sourceId: values["source-id"],
        decision: values.decision,
        limit,
        format,
      };
      if (sub === "append") return runLedgerAppend(ledgerOptions, console);
      if (sub === "list") return runLedgerList(ledgerOptions, console);
      if (sub === "verify") return runLedgerVerify(ledgerOptions, console);
      throw new UsageError(`unknown ledger subcommand "${sub ?? ""}". Use append, list, or verify.`);
    }

    case "scenario": {
      const sub = positionals[1];
      if (sub === "check") {
        return runScenarioCheck(
          { dir: positionals[2] ?? values.dir ?? "scenarios", domain: values.domain, format },
          console,
        );
      }
      if (sub === "gallery") {
        return runGallery(
          {
            dir: values.dir ?? "scenarios",
            out: values.out ?? "docs/SCENARIOS.md",
            check: values.check,
            format,
          },
          console,
        );
      }
      if (sub === "init") {
        const name = positionals[2];
        if (!name) throw new UsageError("scenario init needs a name: changesafe scenario init <name>");
        return runScenarioInit({ name, dir: values.dir ?? "scenarios" }, console);
      }
      throw new UsageError(
        `unknown scenario subcommand "${sub ?? ""}". Use check, init, or gallery.`,
      );
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
