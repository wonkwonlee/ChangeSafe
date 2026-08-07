import { DomainError, type DomainAdapter } from "@changesafe/core";
import { IncidentBundleSchema, networkDomain } from "@changesafe/domain-network";
import {
  KubernetesSnapshotSchema,
  normalizeSnapshot,
  kubernetesDomain,
  type KubernetesSnapshot,
} from "@changesafe/domain-kubernetes";

import { analyzeWithPrompt, type AnalysisResult, type AnalyzeOptions } from "./analyze";
import type { AnalysisPrompt } from "./prompt";
import { networkAnalysisPrompt } from "./prompts/network";
import { kubernetesAnalysisPrompt } from "./prompts/kubernetes";

/**
 * Which domains a model can propose changes in.
 *
 * Not every domain belongs here, and that is a design statement rather than a
 * gap. Terraform is absent because a plan already *is* the proposal — asking
 * a model to restate it would add an unvalidatable step to a pipeline whose
 * whole value is that the change is machine-derived.
 */
export interface AnalysisDomain {
  readonly domainId: string;
  /** Validate raw input for this domain. Returns the domain's own type. */
  parseInput(raw: unknown): unknown;
  /** Parse, propose, and locally validate in one typed step. */
  analyze(raw: unknown, options: AnalyzeOptions): Promise<DomainAnalysis>;
  /**
   * The prompt and the gate adapter, exposed so a caller that needs the
   * unaccepted outcomes too — `eval`, which counts *why* a proposal was
   * rejected — can drive `probeProposal` and then the same policies the gate
   * would run. Without these, every such caller re-hardcodes one domain,
   * which is exactly how the benchmark ended up measuring only network.
   */
  readonly prompt: AnalysisPrompt<never>;
  readonly adapter: DomainAdapter<never, never>;
}

export interface DomainAnalysis extends AnalysisResult {
  /** The validated input, ready to hand to the gate without re-parsing. */
  readonly input: unknown;
}

/**
 * Pair a prompt with the adapter it was actually written against.
 *
 * A single generic `TInput` binds `prompt` and `adapter` together at the
 * call site: pairing a Kubernetes prompt with the network adapter (or any
 * other mismatch) fails to typecheck here, before it can compile into a
 * registry entry that would run the wrong policies against the wrong
 * shape. The erasure to `AnalysisDomain`'s `never`-typed fields still
 * happens — the registry itself is necessarily heterogeneous — but only
 * once such a pairing is already known to be internally consistent.
 */
function defineAnalysisDomain<TInput, TState>(
  domainId: string,
  parseInput: (raw: unknown) => TInput,
  prompt: AnalysisPrompt<TInput>,
  adapter: DomainAdapter<TInput, TState>,
): AnalysisDomain {
  return {
    domainId,
    parseInput,
    async analyze(raw, options) {
      const input = parseInput(raw);
      const result = await analyzeWithPrompt(prompt, input, options);
      return { ...result, input };
    },
    prompt: prompt as unknown as AnalysisPrompt<never>,
    adapter: adapter as unknown as DomainAdapter<never, never>,
  };
}

/**
 * `eval` reads scenario fixtures straight off disk — raw, collector-shaped
 * JSON, the same as a real snapshot collector would produce — but a caller
 * driving this domain directly from the scenario registry may already hold
 * an already-normalized `KubernetesSnapshot`. `normalizeSnapshot` is not
 * idempotent (it expects the raw shape and rejects its own output), so this
 * tries the strict, already-normalized parse first and only normalizes when
 * that fails — the same boundary `packages/cli/src/domains.ts` applies
 * before the gate, extended to accept either shape here.
 */
function parseKubernetesInput(raw: unknown): KubernetesSnapshot {
  const alreadyNormalized = KubernetesSnapshotSchema.safeParse(raw);
  return alreadyNormalized.success ? alreadyNormalized.data : normalizeSnapshot(raw);
}

const ANALYSIS_DOMAINS: Record<string, AnalysisDomain> = {
  network: defineAnalysisDomain(
    "network",
    (raw) => IncidentBundleSchema.parse(raw),
    networkAnalysisPrompt,
    networkDomain,
  ),
  kubernetes: defineAnalysisDomain(
    "kubernetes",
    parseKubernetesInput,
    kubernetesAnalysisPrompt,
    kubernetesDomain,
  ),
};

export const ANALYZABLE_DOMAIN_IDS = Object.keys(ANALYSIS_DOMAINS);

export function resolveAnalysisDomain(domainId: string): AnalysisDomain {
  const domain = ANALYSIS_DOMAINS[domainId];
  if (!domain) {
    throw new DomainError(
      "REQUEST_INVALID",
      domainId === "terraform"
        ? "The terraform domain derives its proposal from the plan itself, so there is nothing for a model to propose. Use `changesafe gate --domain terraform` instead."
        : `No model analysis is available for domain "${domainId}". Analyzable domains: ${ANALYZABLE_DOMAIN_IDS.join(", ")}.`,
    );
  }
  return domain;
}
