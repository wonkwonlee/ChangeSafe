import {
  DomainError,
  createReceipt,
  evaluatePolicies,
  hasBlockingFinding,
  initialState,
  signReceipt,
  transition,
  validateProposalEvidence,
  type Approver,
  type ChangeProposal,
  type ChangeReceipt,
  type SignedReceipt,
  type WorkflowState,
} from "@changesafe/core";
import type { Ledger } from "@changesafe/ledger";

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

export interface DecisionServiceOptions {
  ledger: Ledger;
  appVersion: string;
  /** When present, every issued receipt is signed with it. */
  signingKeyPair?: { privateKey: CryptoKey; publicKey: CryptoKey };
  /** Injectable for deterministic tests. */
  now?: () => string;
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
   * Durable review resolutions require authorship proof. Check that capability
   * before policy evaluation or receipt creation so a missing key can never
   * append an unsigned ledger record and then fail the durable request.
   */
  async decideSigned(
    request: DecisionRequest,
    approver: Approver,
  ): Promise<SignedDecisionOutcome> {
    if (!this.#options.signingKeyPair) {
      throw new DomainError(
        "INTERNAL",
        "Durable review decisions require a configured receipt signing key.",
      );
    }
    const outcome = await this.decide(request, approver);
    if (!("receipt" in outcome.record)) {
      throw new DomainError(
        "INTERNAL",
        "The durable decision path did not produce a signed receipt.",
      );
    }
    return { ...outcome, record: outcome.record };
  }

  async decide(request: DecisionRequest, approver: Approver): Promise<DecisionOutcome> {
    const domain = resolveServerDomain(request.domain);
    const { input, inputId } = domain.parseInput(request.input);
    const proposal = domain.resolveProposal(input, request.proposal);

    // Invented evidence is a validation failure, not a verdict.
    validateProposalEvidence(domain.adapter, input as never, proposal);

    // Recomputed here. Nothing the caller sent about findings is consulted.
    const { findings, riskLevel } = evaluatePolicies(domain.adapter, input as never, proposal);

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

    const receipt = await createReceipt({
      sourceId: request.sourceId,
      inputId,
      input,
      proposal: proposal as ChangeProposal,
      appVersion: this.#options.appVersion,
      policyVersion: domain.adapter.policyVersion,
      mode: "offline",
      model: null,
      fixtureProvenance: null,
      findings,
      riskLevel,
      decision: request.decision === "approve" ? "approved" : "rejected",
      approver,
      simulation,
      createdAtUtc: this.#options.now?.(),
    });

    const record = this.#options.signingKeyPair
      ? await signReceipt(receipt, this.#options.signingKeyPair, {
          signedAtUtc: this.#options.now?.(),
        })
      : receipt;

    // Recorded before the response is returned: a decision the caller was
    // told about but the ledger never saw would be exactly the gap the
    // ledger exists to close.
    const entry = await this.#options.ledger.append(record);

    return {
      record,
      receipt,
      ledgerSeq: entry.seq,
      chainSha256: entry.chainSha256,
    };
  }
}
