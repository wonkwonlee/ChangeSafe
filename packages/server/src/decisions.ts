import {
  canonicalize,
  computePolicyCoverage,
  computePublicKeyId,
  DomainError,
  SignedReceiptSchema,
  createReceipt,
  evaluatePolicies,
  hasBlockingFinding,
  initialState,
  signReceipt,
  transition,
  validateProposalEvidence,
  verifyReceiptHash,
  verifyReceiptSignature,
  type Approver,
  type ChangeProposal,
  type ChangeReceipt,
  type PolicyCoverage,
  type PolicyFinding,
  type RiskLevel,
  type SimulationResult,
  type SignedReceipt,
  type WorkflowState,
} from "@changesafe/core";
import type { Ledger, LedgerEntry } from "@changesafe/ledger";

import { resolveServerDomain } from "./domains";

export interface DecisionRequest {
  domain: string;
  sourceId: string;
  input: unknown;
  /** Ignored by domains that derive the proposal from the input. */
  proposal?: unknown;
  decision: "approve" | "reject";
}

export interface DecisionOutcome {
  record: ChangeReceipt | SignedReceipt;
  receipt: ChangeReceipt;
  ledgerSeq: number;
  chainSha256: string;
}

export interface SignedDecisionOutcome extends DecisionOutcome {
  record: SignedReceipt;
}

export interface DurableDecisionIssuance {
  expectedPolicyVersion: string;
  receiptId: string;
  receiptCreatedAtUtc: string;
  receiptSignedAtUtc: string;
}

export interface DecisionServiceOptions {
  ledger: Ledger;
  appVersion: string;
  /** When present, every issued receipt is signed with it. */
  signingKeyPair?: { privateKey: CryptoKey; publicKey: CryptoKey };
  /**
   * Operator-controlled historical verifying keys, indexed by their
   * out-of-band fingerprint. Required to recover a ledgered receipt after
   * the active signing key has rotated.
   */
  trustedReceiptPublicKeys?: ReadonlyMap<string, CryptoKey>;
  /** Injectable for deterministic tests. */
  now?: () => string;
}

interface EvaluatedRequest {
  domain: ReturnType<typeof resolveServerDomain>;
  input: unknown;
  inputId: string;
  proposal: ChangeProposal;
  policyVersion: string;
  findings: PolicyFinding[];
  riskLevel: RiskLevel;
}

interface PreparedDecision {
  request: DecisionRequest;
  input: unknown;
  inputId: string;
  proposal: ChangeProposal;
  policyVersion: string;
  findings: PolicyFinding[];
  policyCoverage: PolicyCoverage;
  riskLevel: RiskLevel;
  simulation: SimulationResult | null;
}

/**
 * What the deterministic gate says about a pending change, recomputed for a
 * read.
 *
 * This is derived at response time and never stored on a durable record: the
 * state machine and the policy set remain the authority, so a projection
 * persisted beside the artifact could only go stale or be tampered with.
 */
export interface DecisionProjection {
  readonly policyVersion: string;
  readonly findings: readonly PolicyFinding[];
  readonly riskLevel: RiskLevel;
  /** False when a BLOCK finding makes approval impossible for anyone. */
  readonly approvable: boolean;
}

/**
 * The authenticated decision path.
 *
 * The reason to move a decision server-side is not convenience — it is that
 * the client stops being trusted. So this recomputes the findings from the
 * submitted input and proposal rather than accepting any the caller sends:
 * a client that lies about what the gate said changes nothing, because its
 * claim is never read.
 *
 * Everything else is the same machinery the console and CLI use. In
 * particular, approval still goes through `transition`, so a proposal with a
 * BLOCK finding cannot be approved by an authenticated operator any more than
 * by an anonymous one.
 */
export class DecisionService {
  readonly #options: DecisionServiceOptions;

  constructor(options: DecisionServiceOptions) {
    this.#options = options;
  }

  /**
   * Prove every deterministic precondition before a caller reserves an
   * immutable durable-review claim. This performs no receipt or ledger write.
   */
  preflightSigned(request: DecisionRequest, expectedPolicyVersion?: string): void {
    this.#requireSigningCapability();
    this.#prepare(request, expectedPolicyVersion);
  }

  /**
   * Durable review resolutions require authorship proof. Check that capability
   * before policy evaluation or receipt creation so a missing key can never
   * append an unsigned ledger record and then fail the durable request.
   */
  async decideSigned(
    request: DecisionRequest,
    approver: Approver,
    issuance?: DurableDecisionIssuance,
  ): Promise<SignedDecisionOutcome> {
    this.#requireSigningCapability();
    const outcome = await this.decide(request, approver, issuance);
    if (!("receipt" in outcome.record)) {
      throw new DomainError(
        "INTERNAL",
        "The durable decision path did not produce a signed receipt.",
      );
    }
    return { ...outcome, record: outcome.record };
  }

  async decide(
    request: DecisionRequest,
    approver: Approver,
    issuance?: DurableDecisionIssuance,
  ): Promise<DecisionOutcome> {
    const prepared = this.#prepare(request, issuance?.expectedPolicyVersion);

    if (issuance) {
      const existing = this.#options.ledger.get(issuance.receiptId);
      if (existing) {
        return this.#recoverSignedOutcome(existing, prepared, approver, issuance);
      }
    }

    const receipt = await createReceipt({
      sourceId: prepared.request.sourceId,
      inputId: prepared.inputId,
      input: prepared.input,
      proposal: prepared.proposal,
      appVersion: this.#options.appVersion,
      policyVersion: prepared.policyVersion,
      mode: "offline",
      model: null,
      fixtureProvenance: null,
      findings: prepared.findings,
      policyCoverage: prepared.policyCoverage,
      riskLevel: prepared.riskLevel,
      decision: prepared.request.decision === "approve" ? "approved" : "rejected",
      approver,
      simulation: prepared.simulation,
      createdAtUtc: issuance?.receiptCreatedAtUtc ?? this.#options.now?.(),
      receiptId: issuance?.receiptId,
    });

    const record = this.#options.signingKeyPair
      ? await signReceipt(receipt, this.#options.signingKeyPair, {
          signedAtUtc: issuance?.receiptSignedAtUtc ?? this.#options.now?.(),
        })
      : receipt;

    // Recorded before the response is returned: a decision the caller was
    // told about but the ledger never saw would be exactly the gap the
    // ledger exists to close.
    let entry = this.#options.ledger.get(receipt.receiptId);
    if (entry) {
      if (canonicalize(entry.record) !== canonicalize(record)) {
        throw new DomainError(
          "REQUEST_INVALID",
          `Receipt ${receipt.receiptId} is already bound to different immutable ledger content.`,
        );
      }
    } else {
      try {
        entry = await this.#options.ledger.append(record);
      } catch (error) {
        const raced = this.#options.ledger.get(receipt.receiptId);
        if (!raced || canonicalize(raced.record) !== canonicalize(record)) {
          throw error;
        }
        entry = raced;
      }
    }

    return {
      record,
      receipt,
      ledgerSeq: entry.seq,
      chainSha256: entry.chainSha256,
    };
  }

  #requireSigningCapability(): void {
    if (!this.#options.signingKeyPair) {
      throw new DomainError(
        "INTERNAL",
        "Durable review decisions require a configured receipt signing key.",
      );
    }
  }

  /**
   * Recompute findings and risk for a pending change without deciding it.
   *
   * A human asked to approve or reject must be shown what the gate found, and
   * showing them a value the client supplied would defeat the reason the
   * decision moved server-side at all. This runs exactly the same evaluation
   * the decision path runs, and writes nothing: no receipt, no ledger entry,
   * no workflow transition.
   */
  project(
    request: Omit<DecisionRequest, "decision">,
    expectedPolicyVersion?: string,
  ): DecisionProjection {
    const evaluated = this.#evaluate(request, expectedPolicyVersion);
    return Object.freeze({
      policyVersion: evaluated.policyVersion,
      findings: Object.freeze([...evaluated.findings]),
      riskLevel: evaluated.riskLevel,
      approvable: !hasBlockingFinding(evaluated.findings),
    });
  }

  /** The shared recomputation behind both the read projection and a decision. */
  #evaluate(
    request: Omit<DecisionRequest, "decision">,
    expectedPolicyVersion?: string,
  ): EvaluatedRequest {
    const domain = resolveServerDomain(request.domain);
    if (
      expectedPolicyVersion &&
      expectedPolicyVersion !== domain.adapter.policyVersion
    ) {
      throw new DomainError(
        "REQUEST_INVALID",
        `The pending review policy version ${expectedPolicyVersion} is stale; active policy version is ${domain.adapter.policyVersion}.`,
      );
    }
    const { input, inputId } = domain.parseInput(request.input);
    const proposal = domain.resolveProposal(input, request.proposal);

    // Invented evidence is a validation failure, not a verdict.
    validateProposalEvidence(domain.adapter, input as never, proposal);

    // Recomputed here. Nothing the caller sent about findings is consulted.
    const { findings, riskLevel } = evaluatePolicies(domain.adapter, input as never, proposal);

    return {
      domain,
      input,
      inputId,
      proposal: proposal as ChangeProposal,
      policyVersion: domain.adapter.policyVersion,
      findings,
      riskLevel,
    };
  }

  #prepare(
    request: DecisionRequest,
    expectedPolicyVersion?: string,
  ): PreparedDecision {
    const { domain, input, inputId, proposal, policyVersion, findings, riskLevel } =
      this.#evaluate(request, expectedPolicyVersion);

    let state: WorkflowState<unknown> = initialState(request.sourceId, input);
    state = transition(state, { type: "START_ANALYSIS", mode: "offline" });
    state = transition(state, {
      type: "PROPOSAL_RECEIVED",
      proposal,
      mode: "offline",
      provenance: null,
    });
    state = transition(state, { type: "VALIDATION_COMPLETED", findings, riskLevel });
    state = transition(state, { type: "CLASSIFY" });

    if (request.decision === "approve" && hasBlockingFinding(findings)) {
      // The state machine would throw a moment later regardless; refusing
      // here produces a message a caller can act on instead of an internal
      // transition error.
      throw new DomainError(
        "ILLEGAL_TRANSITION",
        "This change has blocking findings and cannot be approved by anyone.",
      );
    }

    let simulation = null;
    if (request.decision === "approve") {
      state = transition(state, { type: "APPROVE" });
      if (domain.simulate) {
        simulation = domain.simulate(input, proposal);
        state = transition(state, { type: "SIMULATION_COMPLETED", simulation });
      }
    } else {
      state = transition(state, { type: "REJECT" });
    }

    // The state machine is the authority on where this ended up, so read the
    // answer back rather than assuming it. A phase other than these means the
    // workflow took a path this code did not intend, and issuing a receipt
    // for it would record a decision that was never actually reached.
    const expected =
      request.decision === "approve" ? (domain.simulate ? "SIMULATED" : "APPROVED") : "REJECTED";
    if (state.phase !== expected) {
      throw new DomainError(
        "INTERNAL",
        "The decision workflow ended in an unexpected state; no receipt was issued.",
      );
    }

    return {
      request,
      input,
      inputId,
      proposal,
      policyVersion,
      findings,
      policyCoverage: computePolicyCoverage(domain.adapter),
      riskLevel,
      simulation,
    };
  }

  async #recoverSignedOutcome(
    entry: LedgerEntry,
    prepared: PreparedDecision,
    approver: Approver,
    issuance: DurableDecisionIssuance,
  ): Promise<SignedDecisionOutcome> {
    const record = SignedReceiptSchema.parse(entry.record);
    if (!(await verifyReceiptHash(record.receipt))) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored receipt ${issuance.receiptId} failed its content-integrity check.`,
      );
    }
    const trustedPublicKey = await this.#trustedRecoveryKey(
      record.signature.publicKeyId,
    );
    if (!trustedPublicKey) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored receipt ${issuance.receiptId} names an unknown signing key.`,
      );
    }
    const signatureVerdict = await verifyReceiptSignature(
      record,
      trustedPublicKey,
    );
    if (signatureVerdict !== "valid") {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored receipt ${issuance.receiptId} failed out-of-band signature verification.`,
      );
    }
    const expected = await createReceipt({
      sourceId: prepared.request.sourceId,
      inputId: prepared.inputId,
      input: prepared.input,
      proposal: prepared.proposal,
      // Recovery validates the immutable historical record. A deployment
      // upgrade must not rewrite its app identity or require the old key.
      appVersion: record.receipt.appVersion,
      policyVersion: prepared.policyVersion,
      mode: "offline",
      model: null,
      fixtureProvenance: null,
      findings: prepared.findings,
      policyCoverage: prepared.policyCoverage,
      riskLevel: prepared.riskLevel,
      decision: prepared.request.decision === "approve" ? "approved" : "rejected",
      approver,
      simulation: prepared.simulation,
      createdAtUtc: issuance.receiptCreatedAtUtc,
      receiptId: issuance.receiptId,
    });
    if (
      canonicalize(expected) !== canonicalize(record.receipt) ||
      record.signature.signedAtUtc !== issuance.receiptSignedAtUtc ||
      entry.receiptId !== issuance.receiptId ||
      entry.receiptSha256 !== record.receipt.receiptSha256
    ) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored receipt ${issuance.receiptId} does not match the immutable decision claim.`,
      );
    }
    const chain = await this.#options.ledger.verifyChain();
    if (!chain.ok) {
      throw new DomainError(
        "REQUEST_INVALID",
        `Stored receipt ${issuance.receiptId} is not in a valid append-only ledger chain.`,
      );
    }
    return {
      record,
      receipt: record.receipt,
      ledgerSeq: entry.seq,
      chainSha256: entry.chainSha256,
    };
  }

  async #trustedRecoveryKey(publicKeyId: string): Promise<CryptoKey | undefined> {
    const historical = this.#options.trustedReceiptPublicKeys?.get(publicKeyId);
    if (historical) return historical;
    const active = this.#options.signingKeyPair?.publicKey;
    if (active && (await computePublicKeyId(active)) === publicKeyId) return active;
    return undefined;
  }
}
