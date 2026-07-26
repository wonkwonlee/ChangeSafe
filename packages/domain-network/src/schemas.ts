import {
  EvidenceIdSchema,
  ID_PATTERN,
  IdSchema,
  TimestampSchema,
  makeProposalSchemas,
} from "@changesafe/core";
import { z } from "zod";

import { own } from "./lookup";

/**
 * The network domain's declarative model: what an incident looks like, what
 * state the gate reasons about, and which operation values are legal.
 *
 * All of it is synthetic by construction — ChangeSafe never reads a real
 * device. Fixtures and imported snapshots pass exactly these schemas.
 */

/** IPv4 address. Bundled data must use documentation ranges (enforced by tests). */
export const Ipv4Schema = z
  .string()
  .regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  .refine(
    (ip) => ip.split(".").every((octet) => Number(octet) <= 255),
    "octets must be 0-255",
  );

export const CidrSchema = z
  .string()
  .regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  .refine((cidr) => {
    const [ip, prefix] = cidr.split("/");
    if (ip === undefined || prefix === undefined) return false;
    return ip.split(".").every((octet) => Number(octet) <= 255) && Number(prefix) <= 32;
  }, "valid IPv4 CIDR required");

// ---------------------------------------------------------------------------
// Untrusted incident content
// ---------------------------------------------------------------------------

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const AlertSchema = z.strictObject({
  evidenceId: EvidenceIdSchema,
  timestamp: TimestampSchema,
  severity: AlertSeveritySchema,
  sourceNodeId: IdSchema,
  message: z.string().min(1).max(2000),
  metric: z
    .strictObject({
      name: z.string().min(1).max(120),
      value: z.number(),
      unit: z.string().min(1).max(40),
    })
    .optional(),
});

/** Operator notes are untrusted free text; they may contain injection attempts. */
export const OperatorNoteSchema = z.strictObject({
  evidenceId: EvidenceIdSchema,
  author: z.string().min(1).max(120),
  timestamp: TimestampSchema,
  content: z.string().min(1).max(4000),
});

// ---------------------------------------------------------------------------
// Topology and declarative state
// ---------------------------------------------------------------------------

export const NodeRoleSchema = z.enum([
  "edge-router",
  "core-router",
  "distribution-switch",
  "firewall",
  "server",
  "mgmt-station",
]);

export const TopologyNodeSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(120),
  role: NodeRoleSchema,
  mgmtIp: Ipv4Schema.optional(),
});

export const LinkStatusSchema = z.enum(["up", "degraded", "down"]);

export const LinkEndpointSchema = z.strictObject({
  nodeId: IdSchema,
  interfaceId: IdSchema,
});

export const TopologyLinkSchema = z.strictObject({
  id: IdSchema,
  a: LinkEndpointSchema,
  b: LinkEndpointSchema,
  status: LinkStatusSchema,
});

export const TopologySchema = z.strictObject({
  nodes: z.array(TopologyNodeSchema).min(1).max(32),
  links: z.array(TopologyLinkSchema).max(64),
});

export const InterfaceStateSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(64),
  enabled: z.boolean(),
  status: LinkStatusSchema,
  description: z.string().max(200).optional(),
  metrics: z
    .strictObject({
      errorRatePct: z.number().min(0).max(100).optional(),
      utilizationPct: z.number().min(0).max(100).optional(),
      crcErrors: z.number().int().min(0).optional(),
    })
    .optional(),
});

export const RouteKindSchema = z.enum(["static", "connected"]);

export const RouteSchema = z.strictObject({
  id: IdSchema,
  destination: CidrSchema,
  nextHop: z.union([Ipv4Schema, z.literal("direct")]),
  metric: z.number().int().min(0).max(1000),
  kind: RouteKindSchema,
  protected: z.boolean(),
  description: z.string().max(200).optional(),
});

export const DeviceStateSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(120),
  role: NodeRoleSchema,
  protected: z.boolean(),
  interfaces: z.record(IdSchema, InterfaceStateSchema),
  routes: z.record(IdSchema, RouteSchema),
  routing: z.strictObject({
    preferences: z.record(
      z.string().min(1).max(64).regex(ID_PATTERN),
      z.union([z.string().max(120), z.number()]),
    ),
  }),
});

export const ManagementDeclarationSchema = z.strictObject({
  originNodeId: IdSchema,
  protectedTargetNodeIds: z.array(IdSchema).min(1).max(16),
});

export const CurrentStateSchema = z.strictObject({
  devices: z.record(IdSchema, DeviceStateSchema),
  management: ManagementDeclarationSchema,
});

/** Machine-checkable safety property; simulation re-evaluates each one. */
export const SafetyCheckSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("mgmt-reachability") }),
  z.strictObject({
    type: z.literal("route-exists"),
    nodeId: IdSchema,
    routeId: IdSchema,
  }),
  z.strictObject({
    type: z.literal("interface-enabled"),
    nodeId: IdSchema,
    interfaceId: IdSchema,
  }),
  z.strictObject({ type: z.literal("protected-resources-intact") }),
]);

export const SafetyPropertySchema = z.strictObject({
  id: IdSchema,
  description: z.string().min(1).max(300),
  check: SafetyCheckSchema,
});

export const IncidentBundleSchema = z
  .strictObject({
    incidentId: IdSchema,
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(2000),
    alerts: z.array(AlertSchema).min(1).max(32),
    operatorNotes: z.array(OperatorNoteSchema).max(16),
    topology: TopologySchema,
    currentState: CurrentStateSchema,
    expectedSafetyProperties: z.array(SafetyPropertySchema).min(1).max(16),
  })
  .superRefine((bundle, ctx) => {
    const nodeIds = new Set(bundle.topology.nodes.map((n) => n.id));
    const deviceIds = new Set(Object.keys(bundle.currentState.devices));

    // Record keys must equal embedded ids so patch paths stay unambiguous.
    for (const [deviceId, device] of Object.entries(bundle.currentState.devices)) {
      if (device.id !== deviceId) {
        ctx.addIssue({
          code: "custom",
          path: ["currentState", "devices", deviceId, "id"],
          message: `device record key "${deviceId}" must match device.id "${device.id}"`,
        });
      }
      for (const [ifId, iface] of Object.entries(device.interfaces)) {
        if (iface.id !== ifId) {
          ctx.addIssue({
            code: "custom",
            path: ["currentState", "devices", deviceId, "interfaces", ifId, "id"],
            message: `interface record key "${ifId}" must match interface.id "${iface.id}"`,
          });
        }
      }
      for (const [routeId, route] of Object.entries(device.routes)) {
        if (route.id !== routeId) {
          ctx.addIssue({
            code: "custom",
            path: ["currentState", "devices", deviceId, "routes", routeId, "id"],
            message: `route record key "${routeId}" must match route.id "${route.id}"`,
          });
        }
      }
    }

    // Every topology link endpoint must reference a known node + interface.
    bundle.topology.links.forEach((link, index) => {
      for (const end of [link.a, link.b]) {
        if (!nodeIds.has(end.nodeId)) {
          ctx.addIssue({
            code: "custom",
            path: ["topology", "links", index],
            message: `link "${link.id}" references unknown node "${end.nodeId}"`,
          });
        } else if (
          deviceIds.has(end.nodeId) &&
          !own(own(bundle.currentState.devices, end.nodeId)?.interfaces ?? {}, end.interfaceId)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["topology", "links", index],
            message: `link "${link.id}" references unknown interface "${end.nodeId}/${end.interfaceId}"`,
          });
        }
      }
    });

    // Alerts must originate from known topology nodes.
    bundle.alerts.forEach((alert, index) => {
      if (!nodeIds.has(alert.sourceNodeId)) {
        ctx.addIssue({
          code: "custom",
          path: ["alerts", index, "sourceNodeId"],
          message: `alert "${alert.evidenceId}" references unknown node "${alert.sourceNodeId}"`,
        });
      }
    });

    // Management origin and every protected target must exist in topology.
    const mgmt = bundle.currentState.management;
    if (!nodeIds.has(mgmt.originNodeId)) {
      ctx.addIssue({
        code: "custom",
        path: ["currentState", "management", "originNodeId"],
        message: `management origin "${mgmt.originNodeId}" is not a topology node`,
      });
    }
    for (const target of mgmt.protectedTargetNodeIds) {
      if (!nodeIds.has(target)) {
        ctx.addIssue({
          code: "custom",
          path: ["currentState", "management", "protectedTargetNodeIds"],
          message: `protected management target "${target}" is not a topology node`,
        });
      }
    }

    // Evidence ids must be globally unique across alerts and notes.
    const seen = new Set<string>();
    for (const evidenceId of [
      ...bundle.alerts.map((a) => a.evidenceId),
      ...bundle.operatorNotes.map((n) => n.evidenceId),
    ]) {
      if (seen.has(evidenceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["alerts"],
          message: `duplicate evidence id "${evidenceId}"`,
        });
      }
      seen.add(evidenceId);
    }

    // Safety property references must resolve.
    bundle.expectedSafetyProperties.forEach((property, index) => {
      const check = property.check;
      if (check.type === "route-exists") {
        if (!own(own(bundle.currentState.devices, check.nodeId)?.routes ?? {}, check.routeId)) {
          ctx.addIssue({
            code: "custom",
            path: ["expectedSafetyProperties", index],
            message: `safety property "${property.id}" references unknown route "${check.nodeId}/${check.routeId}"`,
          });
        }
      }
      if (check.type === "interface-enabled") {
        if (
          !own(own(bundle.currentState.devices, check.nodeId)?.interfaces ?? {}, check.interfaceId)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["expectedSafetyProperties", index],
            message: `safety property "${property.id}" references unknown interface "${check.nodeId}/${check.interfaceId}"`,
          });
        }
      }
    });
  });

// ---------------------------------------------------------------------------
// Network operation values and the model-facing proposal schema
// ---------------------------------------------------------------------------

/**
 * Route object usable as an operation value (all keys required, null for
 * absence) so `add` can create a route and a `remove` inverse can restore one.
 */
export const RouteValueSchema = z.strictObject({
  id: IdSchema,
  destination: CidrSchema,
  nextHop: z.union([Ipv4Schema, z.literal("direct")]),
  metric: z.number().int().min(0).max(1000),
  kind: RouteKindSchema,
  protected: z.boolean(),
  description: z.string().max(200).nullable(),
});

export const OperationValueSchema = z.union([
  z.string().max(400),
  z.number(),
  z.boolean(),
  RouteValueSchema,
  z.null(),
]);

const networkProposalSchemas = makeProposalSchemas(OperationValueSchema);

/** Strict, Structured-Outputs-bindable proposal schema for this domain. */
export const NetworkChangeOperationSchema = networkProposalSchemas.operation;
export const NetworkChangeProposalSchema = networkProposalSchemas.proposal;
export const NetworkReplayFixtureSchema = networkProposalSchemas.replayFixture;

export type Alert = z.infer<typeof AlertSchema>;
export type OperatorNote = z.infer<typeof OperatorNoteSchema>;
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;
export type TopologyLink = z.infer<typeof TopologyLinkSchema>;
export type Topology = z.infer<typeof TopologySchema>;
export type InterfaceState = z.infer<typeof InterfaceStateSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type DeviceState = z.infer<typeof DeviceStateSchema>;
export type CurrentState = z.infer<typeof CurrentStateSchema>;
export type SafetyProperty = z.infer<typeof SafetyPropertySchema>;
export type SafetyCheck = z.infer<typeof SafetyCheckSchema>;
export type IncidentBundle = z.infer<typeof IncidentBundleSchema>;
export type RouteValue = z.infer<typeof RouteValueSchema>;
export type OperationValue = z.infer<typeof OperationValueSchema>;
export type NetworkChangeOperation = z.infer<typeof NetworkChangeOperationSchema>;
export type NetworkChangeProposal = z.infer<typeof NetworkChangeProposalSchema>;
export type NetworkReplayFixture = z.infer<typeof NetworkReplayFixtureSchema>;
