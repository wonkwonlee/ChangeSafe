import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  PolicyPackSchema,
  createReceipt,
  importSigningKeyPair,
  signReceipt,
  evaluatePolicies,
  hasBlockingFinding,
  validateProposalEvidence,
  type AnalysisMode,
  type ChangeProposal,
  type FixtureProvenance,
} from "@changesafe/core";

import { resolveDomain, type CliDomain } from "./domains";
import { CLI_APP_VERSION } from "./version";
import { UsageError, parseOrThrow, readJsonFile, readTextFile } from "./io";
import {
  EXIT_BLOCKED,
  EXIT_OK,
  formatFindings,
  paint,
  type Console,
} from "./output";

export interface GateOptions {
  domain: string;
  input?: string;
  proposal?: string;
  scenario?: string;
  policyPack?: string;
  receipt?: string;
  format: "pretty" | "json";
  sourceId?: string;
  /** Untrusted free text that travelled with the change (a PR body). */
  context?: string;
  /** Private-key PEM; when set, the written receipt is signed. */
  signKey?: string;
  /** Injectable so audited snapshots can use a fixed receipt identity. */
  receiptId?: string;
  /** Injectable so tests get deterministic receipts. */
  now?: string;
  /**
   * Build identity to stamp on the receipt, for regenerating or re-verifying
   * an audited snapshot with a build that is no longer the one that made it.
   * Defaults to this build's own identity, which is what every ordinary run
   * records.
   */
  appVersion?: string;
}

/**
 * Derive a schema-valid source id from a file path. Plan files are commonly
 * named `tfplan.json` or `prod.plan.tfplan.json`, none of which are valid
 * identifiers, so this normalizes rather than failing the run over a name.
 */
function sourceIdFromPath(filePath: string): string {
  const slug = path
    .basename(filePath)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug.slice(0, 64) : "cli-gate";
}

/**
 * Evaluate a proposal against a domain's deterministic gate.
 *
 * This command never approves anything. A clean run means "no policy
 * blocked it", which is an input to a human decision — in CI, the pull
 * request review — not a substitute for one.
 */
export async function runGate(options: GateOptions, console: Console): Promise<number> {
  const domain = resolveDomain(options.domain);

  let inputPath = options.input;
  let proposalPath = options.proposal;
  let sourceId = options.sourceId;

  if (options.scenario) {
    inputPath ??= path.join(options.scenario, "incident.json");
    proposalPath ??= path.join(options.scenario, "replay-fixture.json");
    sourceId ??= path.basename(path.resolve(options.scenario));
  }

  if (!inputPath) {
    throw new UsageError(
      `--input is required (${domain.inputDescription})` +
        (domain.derivesProposalFromInput ? "" : ", or use --scenario <dir>"),
    );
  }
  if (!proposalPath && !domain.derivesProposalFromInput) {
    throw new UsageError("--proposal is required, or use --scenario <dir>");
  }

  // Text that arrived with the change — a PR body, a commit message — is
  // untrusted data the gate scans, never instructions it follows.
  const context = options.context
    ? [{ kind: "context", text: readTextFile(options.context, "context") }]
    : [];

  const { input, inputId } = domain.parseInput(
    readJsonFile(inputPath, domain.derivesProposalFromInput ? "plan" : "incident bundle"),
    context,
  );

  const { proposal, provenance, fixtureId } =
    proposalPath !== undefined
      ? domain.parseProposal(readJsonFile(proposalPath, "proposal"))
      : {
          proposal: domain.deriveProposal?.(input),
          provenance: null,
          fixtureId: null,
        };

  if (!proposal) {
    throw new UsageError(`the ${domain.id} domain could not derive a proposal from the input`);
  }

  return gateParsedProposal(
    {
      domain,
      input,
      inputId,
      proposal: proposal as ChangeProposal,
      provenance: (provenance as FixtureProvenance | null) ?? null,
      fixtureId,
      sourceId: sourceId ?? sourceIdFromPath(inputPath),
      policyPack: options.policyPack,
      receipt: options.receipt,
      signKey: options.signKey,
      receiptId: options.receiptId,
      format: options.format,
      // The proposal was handed to us; this run produced nothing and attests
      // nothing about how it was written.
      mode: "offline",
      model: null,
      now: options.now,
      appVersion: options.appVersion,
    },
    console,
  );
}

export interface GateExecution {
  domain: CliDomain;
  input: unknown;
  inputId: string;
  proposal: ChangeProposal;
  provenance: FixtureProvenance | null;
  fixtureId: string | null;
  sourceId: string;
  policyPack?: string;
  receipt?: string;
  signKey?: string;
  receiptId?: string;
  format: "pretty" | "json";
  /** How this run obtained the proposal. Recorded in the receipt. */
  mode: AnalysisMode;
  /** The model that produced it, when this run called one. */
  model: string | null;
  /** Extra dim line under the header (e.g. which provider proposed). */
  note?: string;
  now?: string;
  /** See GateOptions.appVersion. */
  appVersion?: string;
}

/**
 * Run the deterministic gate over an already-parsed proposal and report it.
 *
 * Both `gate` and `analyze` funnel through here, which is the point: a
 * proposal that a model just produced is judged by exactly the same code, in
 * the same order, as one read from a file. There is no path where analysing
 * and gating in one command applies a different standard.
 */
export async function gateParsedProposal(
  options: GateExecution,
  console: Console,
): Promise<number> {
  const { domain, input, inputId, proposal } = options;

  const policyPack = options.policyPack
    ? parseOrThrow(PolicyPackSchema, readJsonFile(options.policyPack, "policy pack"), "policy pack")
    : null;

  // Invented evidence is a validation failure, not a verdict: the gate
  // cannot evaluate a proposal that cites things the input does not contain.
  validateProposalEvidence(domain.adapter, input as never, proposal);

  const { findings, riskLevel } = evaluatePolicies(
    domain.adapter,
    input as never,
    proposal,
    { policyPack },
  );

  const blocked = hasBlockingFinding(findings);

  if (options.receipt) {
    const unsigned = await createReceipt({
      receiptId: options.receiptId,
      sourceId: options.sourceId,
      inputId,
      input,
      proposal,
      appVersion: options.appVersion ?? CLI_APP_VERSION,
      // The adapter already composes core's version with its own.
      policyVersion: domain.adapter.policyVersion,
      mode: options.mode,
      model: options.model,
      fixtureProvenance: options.provenance,
      findings,
      riskLevel,
      // Never "approved": the CLI gates, and a human decides elsewhere.
      decision: blocked ? "blocked" : "gate_only",
      simulation: null,
      createdAtUtc: options.now,
    });

    // A signed receipt is an envelope around the identical receipt, so
    // signing never changes what was recorded — only who can prove it.
    const record = options.signKey
      ? await signReceipt(
          unsigned,
          await importSigningKeyPair(readTextFile(options.signKey, "signing key")),
          { signedAtUtc: options.now },
        )
      : unsigned;
    writeFileSync(options.receipt, `${JSON.stringify(record, null, 2)}\n`);
  }

  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          domain: domain.id,
          inputId,
          proposalId: proposal.proposalId,
          fixtureId: options.fixtureId,
          provenance: options.provenance,
          mode: options.mode,
          model: options.model,
          findings,
          riskLevel,
          blocked,
          decision: blocked ? "blocked" : "gate_only",
        },
        null,
        2,
      ),
    );
    return blocked ? EXIT_BLOCKED : EXIT_OK;
  }

  console.out("");
  console.out(
    `  ${paint(console.color, "bold", "ChangeSafe gate")} ${paint(
      console.color,
      "dim",
      `· domain ${domain.id} · input ${inputId}`,
    )}`,
  );
  if (options.note) {
    console.out(`  ${paint(console.color, "dim", options.note)}`);
  }
  if (options.provenance) {
    console.out(`  ${paint(console.color, "dim", `proposal provenance: ${options.provenance}`)}`);
  }
  console.out("");
  for (const line of formatFindings(console, findings, riskLevel)) {
    console.out(line);
  }
  console.out("");
  console.out(
    blocked
      ? `  ${paint(console.color, "red", "BLOCKED")} — this change cannot be approved.`
      : `  ${paint(console.color, "green", "no blocking findings")} — a human decision is still required.`,
  );
  if (options.receipt) {
    console.out(`  ${paint(console.color, "dim", `receipt written to ${options.receipt}`)}`);
  }
  console.out("");

  return blocked ? EXIT_BLOCKED : EXIT_OK;
}
