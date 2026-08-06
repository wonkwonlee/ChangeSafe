/**
 * @changesafe/ai — provider-agnostic model adapters.
 *
 * The gate does not depend on this package. Nothing here can approve, block,
 * or influence a verdict; a provider's only power is to suggest a proposal
 * that deterministic policies then judge. Swapping OpenAI for a local Ollama
 * model changes what gets proposed and never changes what is safe.
 *
 * All three adapters speak plain HTTP through an injectable `fetch`, so this
 * package has no dependency outside the workspace and every adapter is
 * testable without a network or a credential.
 */

// Provider contract
export { PROVIDER_IDS, isProviderId } from "./provider";
export type {
  ModelProvider,
  ProposalRequest,
  ProviderCall,
  ProviderId,
  ProviderResult,
} from "./provider";

// Providers and selection
export { openaiProvider } from "./providers/openai";
export { anthropicProvider } from "./providers/anthropic";
export { ollamaProvider } from "./providers/ollama";
export { ALL_PROVIDERS, defaultProvider, resolveModel, resolveProvider } from "./registry";

// Prompts and local validation
export { validateModelProposal } from "./prompt";
export type { AnalysisPrompt } from "./prompt";
export {
  SYSTEM_INSTRUCTIONS,
  buildAnalysisInput,
  networkAnalysisPrompt,
} from "./prompts/network";
export {
  SYSTEM_INSTRUCTIONS as KUBERNETES_SYSTEM_INSTRUCTIONS,
  buildAnalysisInput as buildKubernetesAnalysisInput,
  kubernetesAnalysisPrompt,
} from "./prompts/kubernetes";

// Schema derivation
export { toPortableJsonSchema } from "./json-schema";
export type { JsonSchema } from "./json-schema";

// Analysis
export { REJECTED_OUTCOMES, analyzeWithPrompt, probeProposal } from "./analyze";
export type { AnalysisResult, AnalyzeOptions, ProposalVerdict } from "./analyze";
export { ANALYZABLE_DOMAIN_IDS, resolveAnalysisDomain } from "./domains";
export type { AnalysisDomain, DomainAnalysis } from "./domains";

// Capture
export { captureFixture } from "./capture";
export type { CaptureOptions } from "./capture";
