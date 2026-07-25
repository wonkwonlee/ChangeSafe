/**
 * @changesafe/core — the deterministic airlock engine.
 *
 * An AI (or any producer) supplies a typed change proposal. Pure policies
 * validate it, a human decides, and every outcome becomes a hashed receipt.
 * Core never executes anything, never calls a model, and knows nothing about
 * any particular infrastructure domain — a `DomainAdapter` supplies that.
 */

// Errors
export { DomainError, IllegalTransitionError, isDomainError, toDomainError } from "./errors";
export type { DomainErrorCode } from "./errors";

// Primitives
export {
  ID_PATTERN,
  IdSchema,
  EvidenceIdSchema,
  TimestampSchema,
  Sha256HexSchema,
  StatePathSchema,
  JsonValueSchema,
} from "./primitives";
export type { JsonValue } from "./primitives";

// Analysis mode and provenance
export { AnalysisModeSchema, FixtureProvenanceSchema } from "./analysis";
export type { AnalysisMode, FixtureProvenance } from "./analysis";

// Proposals
export {
  ChangeOpKindSchema,
  ChangeOperationSchema,
  ChangeProposalSchema,
  DiagnosisSchema,
  ReplayFixtureSchema,
  VerificationStepSchema,
  makeProposalSchemas,
} from "./proposal";
export type {
  ProposalLimits,
  ChangeOpKind,
  ChangeOperation,
  ChangeProposal,
  Diagnosis,
  ReplayFixture,
  VerificationStep,
} from "./proposal";

// Findings and risk
export {
  POLICY_ID_PATTERN,
  PolicyFindingSchema,
  PolicyIdSchema,
  PolicyStatusSchema,
  RiskLevelSchema,
  UNIVERSAL_POLICY_IDS,
  deriveRiskLevel,
  hasBlockingFinding,
} from "./findings";
export type { PolicyFinding, PolicyId, PolicyStatus, RiskLevel } from "./findings";

// Simulation
export { DiffEntrySchema, SimulationResultSchema } from "./simulation";
export type { DiffEntry, SimulationResult } from "./simulation";

// Receipts
export { ApproverSchema, ChangeReceiptSchema, ReceiptDecisionSchema } from "./receipt";
export type { Approver, ChangeReceipt, ReceiptDecision } from "./receipt";
export { createReceipt, verifyReceiptHash } from "./create-receipt";
export type { ReceiptInput } from "./create-receipt";
export { canonicalize, canonicallyEqual } from "./canonical";
export { hashCanonical, sha256Hex } from "./hash";

// Receipt signing — integrity is not authorship; a signature is.
export {
  SIGNATURE_ALGORITHM,
  ReceiptSignatureSchema,
  SignedReceiptSchema,
  computePublicKeyId,
  generateSigningKeyPair,
  importSigningKeyPair,
  importVerifyingKey,
  signReceipt,
  verifyReceiptSignature,
} from "./signature";
export type {
  ReceiptSignature,
  SignReceiptOptions,
  SignatureVerdict,
  SignedReceipt,
  SigningKeyPairPem,
} from "./signature";

// Scenario expectations
export { FailureModeSchema, ScenarioExpectationsSchema } from "./expectations";
export type { FailureMode, ScenarioExpectations } from "./expectations";

// Workflow
export { initialState, transition } from "./state-machine";
export type { WorkflowEvent, WorkflowPhase, WorkflowState } from "./state-machine";

// Domain contract and the gate
export type {
  DomainAdapter,
  DomainPolicy,
  PolicyContext,
  PolicyEvaluator,
  SkippedUniversalPolicy,
} from "./domain";
export {
  evaluateBlastRadius,
  evaluatePatchSchema,
  evaluatePolicies,
  evaluateRollbackComplete,
  evaluateUntrustedInstruction,
  evaluateVerificationRequired,
  policyOrder,
  verifyRollback,
} from "./policies";
export type { EvaluateOptions, PolicyEvaluation, RollbackVerdict } from "./policies";

// Policy packs
export { DEFAULT_POLICY_PACK, PolicyPackSchema, resolvePolicyPack } from "./policy-pack";
export type { PolicyPack, ResolvedPolicyPack } from "./policy-pack";

// Validation
export { validateProposalEvidence } from "./validate";

// Versioning
export { CORE_POLICY_VERSION } from "./version";
