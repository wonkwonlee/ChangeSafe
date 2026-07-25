import { DomainError } from "@changesafe/core";
import { IncidentBundleSchema } from "@changesafe/domain-network";

import { analyzeWithPrompt, type AnalysisResult, type AnalyzeOptions } from "./analyze";
import { networkAnalysisPrompt } from "./prompts/network";

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
