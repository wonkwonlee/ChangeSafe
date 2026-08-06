import { DomainError, type DomainAdapter } from "@changesafe/core";
import { IncidentBundleSchema, networkDomain } from "@changesafe/domain-network";
import { KubernetesSnapshotSchema, kubernetesDomain } from "@changesafe/domain-kubernetes";

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

const ANALYSIS_DOMAINS: Record<string, AnalysisDomain> = {
  network: {
    domainId: "network",
    parseInput: (raw) => IncidentBundleSchema.parse(raw),
    async analyze(raw, options) {
      const bundle = IncidentBundleSchema.parse(raw);
      const result = await analyzeWithPrompt(networkAnalysisPrompt, bundle, options);
      return { ...result, input: bundle };
    },
    prompt: networkAnalysisPrompt as unknown as AnalysisPrompt<never>,
    adapter: networkDomain as unknown as DomainAdapter<never, never>,
  },
  kubernetes: {
    domainId: "kubernetes",
    parseInput: (raw) => KubernetesSnapshotSchema.parse(raw),
    async analyze(raw, options) {
      const snapshot = KubernetesSnapshotSchema.parse(raw);
      const result = await analyzeWithPrompt(kubernetesAnalysisPrompt, snapshot, options);
      return { ...result, input: snapshot };
    },
    prompt: kubernetesAnalysisPrompt as unknown as AnalysisPrompt<never>,
    adapter: kubernetesDomain as unknown as DomainAdapter<never, never>,
  },
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
