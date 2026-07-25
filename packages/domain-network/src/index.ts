/**
 * @changesafe/domain-network — the network domain for the ChangeSafe airlock.
 *
 * Supplies a declarative device/topology model, an allowlisted transactional
 * patch engine, deterministic reachability, sandboxed simulation, and the two
 * network-specific policies. Read-only by construction: nothing here can
 * reach a real device.
 */

export { networkDomain, NETWORK_POLICY_VERSION, POLICY_VERSION } from "./adapter";
export type { NetworkPolicyContext } from "./adapter";

export {
  AlertSchema,
  CidrSchema,
  CurrentStateSchema,
  DeviceStateSchema,
  IncidentBundleSchema,
  InterfaceStateSchema,
  Ipv4Schema,
  NetworkChangeOperationSchema,
  NetworkChangeProposalSchema,
  NetworkReplayFixtureSchema,
  OperationValueSchema,
  OperatorNoteSchema,
  RouteSchema,
  RouteValueSchema,
  SafetyPropertySchema,
  TopologySchema,
} from "./schemas";
export type {
  Alert,
  CurrentState,
  DeviceState,
  IncidentBundle,
  InterfaceState,
  NetworkChangeOperation,
  NetworkChangeProposal,
  NetworkReplayFixture,
  OperationValue,
  OperatorNote,
  Route,
  RouteValue,
  SafetyCheck,
  SafetyProperty,
  Topology,
  TopologyLink,
  TopologyNode,
} from "./schemas";

export { applyOperations, affectedDeviceIds } from "./apply";
export type { PatchResult } from "./apply";
export { isOpAllowedForPath, looksExecutable, parsePatchPath } from "./paths";
export type { ParsedPatchPath } from "./paths";
export { deriveInverseOperations } from "./inverse";
export { checkReachability, cidrContains } from "./reachability";
export type { ReachabilityInput, ReachabilityResult } from "./reachability";
export { runSimulation } from "./simulate";
export { evaluateMgmtReachability } from "./policies/mgmt-reachability";
export { evaluateProtectedResource } from "./policies/protected-resource";
