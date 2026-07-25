import type { PolicyContext } from "../domain";
import type { PolicyFinding } from "../findings";

/**
 * UNTRUSTED_INSTRUCTION: deterministic lexical detection of input content
 * that tries to issue instructions (override safety, demand execution, skip
 * approval).
 *
 * This is the trust-boundary evidence policy. It must never be what keeps
 * the system safe — the other policies block unsafe *effects* regardless —
 * and it must never rely on a model noticing an injection.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier)\s+(?:safety\s+)?(?:rules?|instructions?|polic\w+)/i,
  /disregard\s+(?:the\s+)?(?:safety|polic\w+|rules?|instructions?)/i,
  /override\s+(?:the\s+)?(?:safety|polic\w+|approval)/i,
  /bypass\s+(?:the\s+)?(?:safety|polic\w+|approval|gate)/i,
  /do\s+not\s+(?:ask|wait)\s+for\s+(?:approval|review)/i,
  /\b(?:remove|delete|apply|execute|run)\b[^.!?\n]*\bimmediately\b/i,
  /\bexecute\s+(?:this|the)\s+(?:command|change)\b/i,
  /\byou\s+(?:must|should)\s+(?:approve|apply|execute)\b/i,
];

export function evaluateUntrustedInstruction<TInput, TState>(
  context: PolicyContext<TInput, TState>,
): PolicyFinding {
  const { adapter, input } = context;
  const hits: { evidenceId: string; kind: string; excerpt: string }[] = [];

  for (const source of adapter.untrustedTexts(input)) {
    for (const pattern of INSTRUCTION_PATTERNS) {
      const match = pattern.exec(source.text);
      if (match) {
        hits.push({ evidenceId: source.evidenceId, kind: source.kind, excerpt: match[0] });
        break;
      }
    }
  }

  if (hits.length > 0) {
    return {
      policyId: "UNTRUSTED_INSTRUCTION",
      status: "WARN",
      title: "Incident content contains instruction-like language",
      explanation:
        hits
          .map((hit) => `${hit.kind} ${hit.evidenceId} contains "${hit.excerpt}"`)
          .join("; ") +
        ". Incident inputs are data, not instructions — this content was flagged deterministically and had no ability to alter policy evaluation.",
      affectedResources: hits.map((hit) => `evidence:${hit.evidenceId}`),
      remediation:
        "Treat the flagged content as untrusted. Verify the underlying facts independently before acting on them.",
    };
  }

  return {
    policyId: "UNTRUSTED_INSTRUCTION",
    status: "PASS",
    title: "No instruction-like language in incident inputs",
    explanation: "No alert or operator note attempts to issue instructions to the system.",
    affectedResources: [],
    remediation: null,
  };
}
