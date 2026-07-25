import {
  CORE_POLICY_VERSION,
  type ChangeOperation,
  type DomainAdapter,
  type PolicyContext,
} from "@changesafe/core";

import { applyOperations } from "./apply";
import { parsePatchPath } from "./paths";
import { evaluateMgmtReachability } from "./policies/mgmt-reachability";
import { evaluateProtectedResource } from "./policies/protected-resource";
import type { CurrentState, IncidentBundle } from "./schemas";

/** Bumped whenever any network policy's behavior changes; recorded in receipts. */
export const NETWORK_POLICY_VERSION = "network-v0.1.0";

/** The policy version a receipt records: the exact gate that produced it. */
export const POLICY_VERSION = `${CORE_POLICY_VERSION}+${NETWORK_POLICY_VERSION}`;

export type NetworkPolicyContext = PolicyContext<IncidentBundle, CurrentState>;

/**
 * The network domain, expressed through core's adapter contract.
 *
 * Everything here is pure: no IO, no clock, no randomness, and no model. The
 * adapter is what lets core's universal policies count blast radius, verify
 * rollbacks, and scan untrusted text without knowing what a router is.
 */
export const networkDomain: DomainAdapter<IncidentBundle, CurrentState> = {
  domainId: "network",
  policyVersion: POLICY_VERSION,

  stateOf(bundle) {
    return bundle.currentState;
  },

  applyOperations(state, operations) {
    return applyOperations(state, operations);
  },

  blastRadiusUnit(operation: ChangeOperation) {
    const parsed = parsePatchPath(operation.path);
    return parsed ? { kind: "device", id: parsed.deviceId } : null;
  },

  untrustedTexts(bundle) {
    return [
      ...bundle.alerts.map((alert) => ({
        evidenceId: alert.evidenceId,
        kind: "alert",
        text: alert.message,
      })),
      ...bundle.operatorNotes.map((note) => ({
        evidenceId: note.evidenceId,
        kind: "operator note",
        text: note.content,
      })),
    ];
  },

  knownEvidenceIds(bundle) {
    return new Set([
      ...bundle.alerts.map((alert) => alert.evidenceId),
      ...bundle.operatorNotes.map((note) => note.evidenceId),
    ]);
  },

  policies: [
    { id: "MGMT_REACHABILITY", evaluate: evaluateMgmtReachability },
    { id: "PROTECTED_RESOURCE", evaluate: evaluateProtectedResource },
  ],
};
