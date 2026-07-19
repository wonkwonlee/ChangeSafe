import type {
  AnalysisMode,
  ChangeProposal,
  ChangeReceipt,
  FixtureProvenance,
  IncidentBundle,
  PolicyFinding,
  ReceiptDecision,
  RiskLevel,
  SimulationResult,
} from "@/lib/domain/schemas";
import { ChangeReceiptSchema } from "@/lib/domain/schemas";
import { APP_VERSION, POLICY_VERSION } from "@/lib/domain/version";
import { hashCanonical } from "./hash";

export interface ReceiptInput {
  scenarioId: string;
  bundle: IncidentBundle;
  proposal: ChangeProposal;
  mode: AnalysisMode;
  /** Runtime model for live analyses; null when replaying an authored fixture. */
  model: string | null;
  fixtureProvenance: FixtureProvenance | null;
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
  decision: ReceiptDecision;
  simulation: SimulationResult | null;
  /** Injectable for deterministic tests; defaults to the current UTC instant. */
  createdAtUtc?: string;
  receiptId?: string;
}

/**
 * Builds the downloadable change receipt. Incident and proposal are hashed
 * from their canonical serializations; the receipt hash covers the canonical
 * receipt content excluding the hash field itself. The finished receipt is
 * re-validated against the schema so decision/simulation invariants can never
 * be bypassed by direct calls.
 */
export async function createReceipt(input: ReceiptInput): Promise<ChangeReceipt> {
  const [incidentSha256, proposalSha256] = await Promise.all([
    hashCanonical(input.bundle),
    hashCanonical(input.proposal),
  ]);

  const unhashed: Omit<ChangeReceipt, "receiptSha256"> = {
    receiptId: input.receiptId ?? `rcpt-${globalThis.crypto.randomUUID()}`,
    incidentId: input.bundle.incidentId,
    proposalId: input.proposal.proposalId,
    scenarioId: input.scenarioId,
    appVersion: APP_VERSION,
    policyVersion: POLICY_VERSION,
    createdAtUtc: input.createdAtUtc ?? new Date().toISOString(),
    mode: input.mode,
    model: input.model,
    fixtureProvenance: input.fixtureProvenance,
    incidentSha256,
    proposalSha256,
    findings: input.findings,
    riskLevel: input.riskLevel,
    decision: input.decision,
    simulation: input.simulation,
  };

  const receiptSha256 = await hashCanonical(unhashed);
  return ChangeReceiptSchema.parse({ ...unhashed, receiptSha256 });
}

/** Recompute and compare the receipt's self-hash — used by tests and download verification. */
export async function verifyReceiptHash(receipt: ChangeReceipt): Promise<boolean> {
  const { receiptSha256, ...unhashed } = receipt;
  return (await hashCanonical(unhashed)) === receiptSha256;
}
