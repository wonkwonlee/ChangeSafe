import type { PolicyFinding } from "@/lib/domain/schemas";
import type { PolicyContext } from "./context";

/**
 * UNTRUSTED_INSTRUCTION: deterministic lexical detection of incident content
 * that tries to issue instructions (override safety, demand execution, skip
 * approval). This is the trust-boundary evidence policy — it must never rely
 * on the model noticing an injection.
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

export function evaluateUntrustedInstruction(context: PolicyContext): PolicyFinding {
  const { bundle } = context;
  const hits: { evidenceId: string; kind: "alert" | "operator note"; excerpt: string }[] = [];

  const scan = (evidenceId: string, kind: "alert" | "operator note", text: string) => {
    for (const pattern of INSTRUCTION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        hits.push({ evidenceId, kind, excerpt: match[0] });
        return;
      }
    }
  };

  for (const alert of bundle.alerts) scan(alert.evidenceId, "alert", alert.message);
  for (const note of bundle.operatorNotes) scan(note.evidenceId, "operator note", note.content);

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
