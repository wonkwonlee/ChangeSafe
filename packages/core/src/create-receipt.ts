import type { AnalysisMode, FixtureProvenance } from "./analysis";
import type { PolicyFinding, RiskLevel } from "./findings";
import { hashCanonical } from "./hash";
import type { ChangeProposal } from "./proposal";
import {
  ChangeReceiptSchema,
  type Approver,
  type ChangeReceipt,
  type ReceiptDecision,
} from "./receipt";
import type { SimulationResult } from "./simulation";

export interface ReceiptInput {
  /** Where the analyzed input came from (scenario id, file, pipeline run). */
  sourceId: string;
  /** Identifier of the analyzed input itself. */
  inputId: string;
  /** The analyzed input, hashed canonically into the receipt. */
  input: unknown;
  proposal: ChangeProposal;
  appVersion: string;
  policyVersion: string;
  mode: AnalysisMode;
  /** Runtime model for live analyses; null when replaying an authored fixture. */
  model: string | null;
  fixtureProvenance: FixtureProvenance | null;
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
  decision: ReceiptDecision;
  /** Authenticated approver, when the decision came through an authenticated
   *  path. Defaults to null: absence of a claim, not a claim of absence. */
  approver?: Approver | null;
  simulation: SimulationResult | null;
  /** Injectable for deterministic tests; defaults to the current UTC instant. */
  createdAtUtc?: string;
  receiptId?: string;
}

/**
 * Build the durable change receipt. Input and proposal are hashed from their
 * canonical serializations; the receipt hash covers the canonical receipt
 * content excluding the hash field itself. The finished receipt is
 * re-validated against the schema, so decision/simulation invariants cannot
 * be bypassed by calling this directly.
 */
export async function createReceipt(input: ReceiptInput): Promise<ChangeReceipt> {
  const [inputSha256, proposalSha256] = await Promise.all([
    hashCanonical(input.input),
    hashCanonical(input.proposal),
  ]);

  const unhashed: Omit<ChangeReceipt, "receiptSha256"> = {
    receiptId: input.receiptId ?? `rcpt-${globalThis.crypto.randomUUID()}`,
    inputId: input.inputId,
    proposalId: input.proposal.proposalId,
    sourceId: input.sourceId,
    appVersion: input.appVersion,
    policyVersion: input.policyVersion,
    createdAtUtc: input.createdAtUtc ?? new Date().toISOString(),
    mode: input.mode,
    model: input.model,
    fixtureProvenance: input.fixtureProvenance,
    inputSha256,
    proposalSha256,
    findings: input.findings,
    riskLevel: input.riskLevel,
    decision: input.decision,
    approver: input.approver ?? null,
    simulation: input.simulation,
  };

  const receiptSha256 = await hashCanonical(unhashed);
  return ChangeReceiptSchema.parse({ ...unhashed, receiptSha256 });
}

/** Recompute and compare a receipt's self-hash — used by tests and verification. */
export async function verifyReceiptHash(receipt: ChangeReceipt): Promise<boolean> {
  const { receiptSha256, ...unhashed } = receipt;
  return (await hashCanonical(unhashed)) === receiptSha256;
}
