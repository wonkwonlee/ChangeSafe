import type { ChangeOperation, ChangeProposal, ChangeReceipt, PolicyFinding, PolicyStatus, SimulationResult } from "@changesafe/core";
import type { IncidentBundle } from "@changesafe/domain-network";
import { APP_VERSION, POLICY_VERSION } from "@/lib/domain/version";

/**
 * Minimal-but-realistic synthetic fixtures for unit tests. All values are
 * fictional; IP-like values use documentation ranges (192.0.2.0/24 etc.).
 * Bundled product scenarios live in scenarios/, not here.
 */

export function buildIncidentBundle(): IncidentBundle {
  return {
    incidentId: "inc-test-001",
    title: "Degraded primary uplink on edge-rtr-01",
    summary: "Primary uplink shows CRC errors; backup path is healthy.",
    alerts: [
      {
        evidenceId: "ev-alert-001",
        timestamp: "2026-07-18T09:12:00Z",
        severity: "critical",
        sourceNodeId: "edge-rtr-01",
        message: "Interface wan-primary error rate exceeded threshold",
        metric: { name: "errorRatePct", value: 12.5, unit: "percent" },
      },
    ],
    operatorNotes: [
      {
        evidenceId: "ev-note-001",
        author: "on-call engineer",
        timestamp: "2026-07-18T09:15:00Z",
        content: "Users report intermittent packet loss towards the WAN.",
      },
    ],
    topology: {
      nodes: [
        { id: "mgmt-01", name: "Management Station", role: "mgmt-station", mgmtIp: "192.0.2.10" },
        { id: "edge-rtr-01", name: "Edge Router 01", role: "edge-router", mgmtIp: "192.0.2.1" },
      ],
      links: [
        {
          id: "link-mgmt-edge",
          a: { nodeId: "mgmt-01", interfaceId: "eth0" },
          b: { nodeId: "edge-rtr-01", interfaceId: "mgmt0" },
          status: "up",
        },
      ],
    },
    currentState: {
      devices: {
        "mgmt-01": {
          id: "mgmt-01",
          name: "Management Station",
          role: "mgmt-station",
          protected: true,
          interfaces: {
            eth0: {
              id: "eth0",
              name: "eth0",
              enabled: true,
              status: "up",
            },
          },
          routes: {},
          routing: { preferences: {} },
        },
        "edge-rtr-01": {
          id: "edge-rtr-01",
          name: "Edge Router 01",
          role: "edge-router",
          protected: false,
          interfaces: {
            mgmt0: {
              id: "mgmt0",
              name: "mgmt0",
              enabled: true,
              status: "up",
              description: "Management interface",
            },
            "wan-primary": {
              id: "wan-primary",
              name: "wan-primary",
              enabled: true,
              status: "degraded",
              metrics: { errorRatePct: 12.5, crcErrors: 4211 },
            },
            "wan-backup": {
              id: "wan-backup",
              name: "wan-backup",
              enabled: true,
              status: "up",
              metrics: { errorRatePct: 0.1 },
            },
          },
          routes: {
            "rt-default-primary": {
              id: "rt-default-primary",
              destination: "0.0.0.0/0",
              nextHop: "203.0.113.1",
              metric: 10,
              kind: "static",
              protected: false,
              description: "Default route via primary uplink",
            },
            "rt-default-backup": {
              id: "rt-default-backup",
              destination: "0.0.0.0/0",
              nextHop: "203.0.113.9",
              metric: 200,
              kind: "static",
              protected: false,
              description: "Default route via backup uplink",
            },
            "rt-mgmt": {
              id: "rt-mgmt",
              destination: "192.0.2.0/24",
              nextHop: "direct",
              metric: 0,
              kind: "connected",
              protected: true,
              description: "Management subnet",
            },
          },
          routing: { preferences: { "active-uplink": "wan-primary" } },
        },
      },
      management: {
        originNodeId: "mgmt-01",
        protectedTargetNodeIds: ["edge-rtr-01"],
      },
    },
    expectedSafetyProperties: [
      {
        id: "sp-mgmt-reachability",
        description: "Management station keeps reachability to all protected devices",
        check: { type: "mgmt-reachability" },
      },
      {
        id: "sp-mgmt-route",
        description: "Management route on edge-rtr-01 remains present",
        check: { type: "route-exists", nodeId: "edge-rtr-01", routeId: "rt-mgmt" },
      },
    ],
  };
}

export function buildOperation(overrides: Partial<ChangeOperation> = {}): ChangeOperation {
  return {
    op: "replace",
    path: "/devices/edge-rtr-01/routes/rt-default-backup/metric",
    value: 5,
    reason: "Prefer healthy backup uplink while primary is degraded",
    evidenceIds: ["ev-alert-001"],
    ...overrides,
  };
}

export function buildProposal(overrides: Partial<ChangeProposal> = {}): ChangeProposal {
  return {
    proposalId: "prop-test-001",
    summary: "Shift default routing preference to the healthy backup uplink.",
    diagnosis: {
      likelyCause: "Physical degradation on wan-primary causing CRC errors",
      confidence: 0.82,
      evidenceIds: ["ev-alert-001", "ev-note-001"],
      assumptions: ["Backup uplink has sufficient capacity for current load"],
    },
    operations: [buildOperation()],
    rollbackOperations: [
      buildOperation({
        value: 200,
        reason: "Restore original backup route metric",
      }),
    ],
    verificationSteps: [
      {
        kind: "precondition",
        description: "Confirm wan-backup interface is up with low error rate",
        evidenceIds: ["ev-alert-001"],
      },
      {
        kind: "postcheck",
        description: "Confirm default traffic egresses via wan-backup and loss stops",
        evidenceIds: [],
      },
    ],
    ...overrides,
  };
}

export function buildFinding(
  status: PolicyStatus,
  overrides: Partial<PolicyFinding> = {},
): PolicyFinding {
  return {
    policyId: "BLAST_RADIUS",
    status,
    title: `Test finding (${status})`,
    explanation: "Synthetic finding used by unit tests.",
    affectedResources: ["device:edge-rtr-01"],
    remediation: null,
    ...overrides,
  };
}

export function buildSimulation(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    status: "completed",
    changedResourceIds: ["device:edge-rtr-01"],
    diff: [
      {
        op: "replace",
        path: "/devices/edge-rtr-01/routes/rt-default-backup/metric",
        before: 200,
        after: 5,
      },
    ],
    safetyProperties: [
      {
        propertyId: "sp-mgmt-reachability",
        satisfied: true,
        detail: "Management station still reaches every protected device.",
      },
    ],
    summary: "1 resource changed; all declared safety properties remain satisfied.",
    ...overrides,
  };
}

const DUMMY_SHA = "a".repeat(64);

export function buildReceipt(overrides: Partial<ChangeReceipt> = {}): ChangeReceipt {
  return {
    receiptId: "rcpt-test-001",
    inputId: "inc-test-001",
    proposalId: "prop-test-001",
    sourceId: "scenario-test",
    appVersion: APP_VERSION,
    policyVersion: POLICY_VERSION,
    createdAtUtc: "2026-07-18T10:00:00Z",
    mode: "replay",
    model: null,
    fixtureProvenance: "authored_synthetic",
    inputSha256: DUMMY_SHA,
    proposalSha256: DUMMY_SHA,
    findings: [buildFinding("PASS")],
    riskLevel: "LOW",
    decision: "rejected",
    approver: null,
    simulation: null,
    receiptSha256: DUMMY_SHA,
    ...overrides,
  };
}
