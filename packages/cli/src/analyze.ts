import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  ALL_PROVIDERS,
  captureFixture,
  defaultProvider,
  resolveAnalysisDomain,
  resolveModel,
  resolveProvider,
  type ModelProvider,
} from "@changesafe/ai";
import type { ChangeProposal } from "@changesafe/core";

import { resolveDomain } from "./domains";
import { gateParsedProposal } from "./gate";
import { UsageError, readJsonFile, resolveTimeoutMs } from "./io";
import { paint, type Console } from "./output";

export interface AnalyzeCommandOptions {
  domain: string;
  input?: string;
  scenario?: string;
  provider?: string;
  model?: string;
  /** Per-call provider deadline in seconds; overrides the provider default. */
  timeoutSeconds?: number;
  /** Write the accepted proposal here. */
  out?: string;
  /** Write a provenance-stamped replay fixture here. */
  capture?: string;
  policyPack?: string;
  receipt?: string;
  signKey?: string;
  receiptId?: string;
  /** Fixed receipt and signature time for audited snapshot generation. */
  receiptCreatedAtUtc?: string;
  sourceId?: string;
  format: "pretty" | "json";
  /** Injectable capture time; never derived from receipt snapshot metadata. */
  now?: string;
}

/**
 * Ask a model for a change, then gate it.
 *
 * This is the only command that calls a model, and it is deliberately not a
 * shortcut around anything: the proposal it obtains is handed to the same
 * `gateParsedProposal` that `changesafe gate` uses, so a model-produced
 * change is judged exactly like a file-produced one. Analysis failures exit
 * 2 — a missing verdict, never a clean one.
 */
export async function runAnalyze(
  options: AnalyzeCommandOptions,
  console: Console,
): Promise<number> {
  // Both registries must agree: one supplies the prompt, the other the gate.
  const analysisDomain = resolveAnalysisDomain(options.domain);
  const gateDomain = resolveDomain(options.domain);

  const inputPath =
    options.input ?? (options.scenario ? path.join(options.scenario, "incident.json") : undefined);
  if (!inputPath) {
    throw new UsageError(
      `--input is required (${gateDomain.inputDescription}), or use --scenario <dir>`,
    );
  }

  const provider = pickProvider(options.provider);
  const model = resolveModel(provider, process.env, options.model);

  if (options.format === "pretty") {
    console.err(
      `  ${paint(console.color, "dim", `asking ${provider.label} (${model}) for a proposal…`)}`,
    );
  }

  const analysis = await analysisDomain.analyze(readJsonFile(inputPath, "incident bundle"), {
    provider,
    model,
    timeoutMs: resolveTimeoutMs(options.timeoutSeconds),
  });

  const sourceId =
    options.sourceId ??
    (options.scenario ? path.basename(path.resolve(options.scenario)) : undefined) ??
    "cli-analyze";

  if (options.out) {
    writeFileSync(options.out, `${JSON.stringify(analysis.proposal, null, 2)}\n`);
  }

  if (options.capture) {
    const fixture = captureFixture(analysis, {
      scenarioId: sourceId,
      capturedAtUtc: options.now ?? new Date().toISOString(),
    });
    writeFileSync(options.capture, `${JSON.stringify(fixture, null, 2)}\n`);
  }

  const { inputId } = gateDomain.parseInput(analysis.input);

  const exitCode = await gateParsedProposal(
    {
      domain: gateDomain,
      input: analysis.input,
      inputId,
      proposal: analysis.proposal as ChangeProposal,
      // A live analysis is not a fixture; it has no fixture provenance.
      provenance: null,
      fixtureId: null,
      sourceId,
      policyPack: options.policyPack,
      receipt: options.receipt,
      signKey: options.signKey,
      receiptId: options.receiptId,
      format: options.format,
      mode: "live",
      model: analysis.model,
      note: `proposed live by ${provider.label} · model ${analysis.model}`,
      now: options.receiptCreatedAtUtc,
    },
    console,
  );

  if (options.format === "pretty") {
    if (options.out) {
      console.out(`  ${paint(console.color, "dim", `proposal written to ${options.out}`)}`);
    }
    if (options.capture) {
      console.out(
        `  ${paint(console.color, "dim", `capture written to ${options.capture} (review before promoting it to a bundled fixture)`)}`,
      );
    }
    if (options.out || options.capture) console.out("");
  }

  return exitCode;
}

/**
 * Resolve which provider to call. An explicit `--provider` always wins; with
 * no flag, a configured hosted provider is used. Being unable to choose is a
 * usage error rather than a silent fallback — quietly picking a different
 * model than the operator expected is worse than stopping.
 */
function pickProvider(requested: string | undefined): ModelProvider {
  if (requested) {
    const provider = resolveProvider(requested);
    if (!provider.isConfigured(process.env)) {
      throw new UsageError(
        provider.credentialEnvVar
          ? `${provider.label} needs ${provider.credentialEnvVar} to be set`
          : `${provider.label} is not available`,
      );
    }
    return provider;
  }

  const provider = defaultProvider(process.env);
  if (!provider) {
    const options = ALL_PROVIDERS.map((candidate) =>
      candidate.credentialEnvVar
        ? `--provider ${candidate.id} (needs ${candidate.credentialEnvVar})`
        : `--provider ${candidate.id} (local, no credential)`,
    );
    throw new UsageError(
      `no model provider is configured. Choose one:\n  ${options.join("\n  ")}`,
    );
  }
  return provider;
}
