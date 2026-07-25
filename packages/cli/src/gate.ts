import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  PolicyPackSchema,
  createReceipt,
  evaluatePolicies,
  hasBlockingFinding,
  validateProposalEvidence,
  type ChangeProposal,
  type FixtureProvenance,
} from "@changesafe/core";

import { resolveDomain } from "./domains";
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
  /** Injectable so tests get deterministic receipts. */
  now?: string;
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

  const policyPack = options.policyPack
    ? parseOrThrow(PolicyPackSchema, readJsonFile(options.policyPack, "policy pack"), "policy pack")
    : null;

  // Invented evidence is a validation failure, not a verdict: the gate
  // cannot evaluate a proposal that cites things the input does not contain.
  validateProposalEvidence(
    domain.adapter,
    input as never,
    proposal as ChangeProposal,
  );

  const { findings, riskLevel } = evaluatePolicies(
    domain.adapter,
    input as never,
    proposal as ChangeProposal,
    { policyPack },
  );

  const blocked = hasBlockingFinding(findings);

  if (options.receipt) {
    const receipt = await createReceipt({
      sourceId: sourceId ?? sourceIdFromPath(inputPath),
      inputId,
      input,
      proposal: proposal as ChangeProposal,
      appVersion: `changesafe-cli-0.1.0`,
      // The adapter already composes core's version with its own.
      policyVersion: domain.adapter.policyVersion,
      // The proposal was handed to us; this run produced nothing and
      // attests nothing about how it was written.
      mode: "offline",
      model: null,
      fixtureProvenance: (provenance as FixtureProvenance | null) ?? null,
      findings,
      riskLevel,
      decision: blocked ? "blocked" : "gate_only",
      simulation: null,
      createdAtUtc: options.now,
    });
    writeFileSync(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  }

  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          domain: domain.id,
          inputId,
          proposalId: (proposal as ChangeProposal).proposalId,
          fixtureId,
          provenance,
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
  if (provenance) {
    console.out(`  ${paint(console.color, "dim", `proposal provenance: ${provenance}`)}`);
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
