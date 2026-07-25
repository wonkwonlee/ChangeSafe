import { z } from "zod";

/**
 * Domain schemas are the single source of truth for every boundary in
 * ChangeSafe: scenario fixtures, model output, policy findings, simulation
 * results, and receipts. Zod schemas are defined first; all public types are
 * inferred from them.
 *
 * Invariant: model-facing schemas (ChangeProposal and everything it embeds)
 * must stay compatible with OpenAI Structured Outputs strict mode — every key
 * required, no dynamic-key records, absence expressed as null.
 */

// ---------------------------------------------------------------------------
// Identifiers and primitives
// ---------------------------------------------------------------------------

export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const IdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(ID_PATTERN, "identifiers are lowercase kebab-case");

export const EvidenceIdSchema = z
  .string()
  .max(64)
  .regex(/^ev-[a-z0-9]+(?:-[a-z0-9]+)*$/, "evidence ids look like ev-alert-001");

export const TimestampSchema = z.iso.datetime({ message: "UTC ISO-8601 timestamp required" });

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, "lowercase sha-256 hex");

/** Documentation-range IPv4 address (fictional data only; enforced by fixture review, shape here). */
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
    return (
      ip.split(".").every((octet) => Number(octet) <= 255) && Number(prefix) <= 32
    );
  }, "valid IPv4 CIDR required");

/** Arbitrary JSON value — used for diffs and captured pre-change values. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

// ---------------------------------------------------------------------------
// Incident bundle — synthetic, untrusted input to analysis
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
          !bundle.currentState.devices[end.nodeId]?.interfaces[end.interfaceId]
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
        if (!bundle.currentState.devices[check.nodeId]?.routes[check.routeId]) {
          ctx.addIssue({
            code: "custom",
            path: ["expectedSafetyProperties", index],
            message: `safety property "${property.id}" references unknown route "${check.nodeId}/${check.routeId}"`,
          });
        }
      }
      if (check.type === "interface-enabled") {
        if (!bundle.currentState.devices[check.nodeId]?.interfaces[check.interfaceId]) {
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
// Change proposal — model-facing (Structured Outputs strict compatible)
// ---------------------------------------------------------------------------

export const ChangeOpKindSchema = z.enum(["add", "replace", "remove"]);

/** Declarative state path, e.g. /devices/edge-rtr-01/routes/rt-default-backup/metric */
export const StatePathSchema = z
  .string()
  .min(2)
  .max(256)
  .regex(/^(\/[a-z0-9][a-z0-9-]*)+$/, "paths are /segment/segment with kebab-case segments");

/**
 * Route object shape usable as an operation value (all keys required, null for
 * absence) so `add` can create a route and `remove` inverses can restore one.
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

export const ChangeOperationSchema = z.strictObject({
  op: ChangeOpKindSchema,
  path: StatePathSchema,
  /** Required for add/replace; must be null for remove (checked past schema level). */
  value: OperationValueSchema,
  reason: z.string().min(1).max(500),
  evidenceIds: z.array(EvidenceIdSchema).min(1).max(10),
});

export const VerificationStepSchema = z.strictObject({
  kind: z.enum(["precondition", "postcheck"]),
  description: z.string().min(1).max(500),
  evidenceIds: z.array(EvidenceIdSchema).max(10),
});

export const DiagnosisSchema = z.strictObject({
  likelyCause: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1).max(20),
  assumptions: z.array(z.string().min(1).max(400)).max(10),
});

export const ChangeProposalSchema = z.strictObject({
  proposalId: IdSchema,
  summary: z.string().min(1).max(1000),
  diagnosis: DiagnosisSchema,
  operations: z.array(ChangeOperationSchema).min(1).max(10),
  /** Empty rollback is schema-valid so ROLLBACK_COMPLETE can BLOCK it deterministically. */
  rollbackOperations: z.array(ChangeOperationSchema).max(10),
  /** Empty steps are schema-valid so VERIFICATION_REQUIRED can WARN deterministically. */
  verificationSteps: z.array(VerificationStepSchema).max(10),
});

// ---------------------------------------------------------------------------
// Policy findings and risk
// ---------------------------------------------------------------------------

export const PolicyIdSchema = z.enum([
  "PATCH_SCHEMA",
  "MGMT_REACHABILITY",
  "PROTECTED_RESOURCE",
  "BLAST_RADIUS",
  "ROLLBACK_COMPLETE",
  "VERIFICATION_REQUIRED",
  "UNTRUSTED_INSTRUCTION",
]);

export const PolicyStatusSchema = z.enum(["PASS", "WARN", "BLOCK"]);

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const PolicyFindingSchema = z.strictObject({
  policyId: PolicyIdSchema,
  status: PolicyStatusSchema,
  title: z.string().min(1).max(160),
  explanation: z.string().min(1).max(2000),
  /** Stable resource references, e.g. "device:edge-rtr-01" or a state path. */
  affectedResources: z.array(z.string().min(1).max(256)).max(32),
  remediation: z.string().max(1000).nullable(),
});

// ---------------------------------------------------------------------------
// Scenario expectations — the machine-checked contract of a bundled scenario
// ---------------------------------------------------------------------------

/**
 * Every policy must be declared, so an author cannot leave a verdict
 * unconsidered when contributing a scenario.
 */
export const PolicyExpectationMapSchema = z.record(PolicyIdSchema, PolicyStatusSchema);

/**
 * What a scenario claims the deterministic gate will do with it. The claims
 * are deliberately redundant (risk and approvability are derivable from the
 * policy statuses) so the file reads as documentation while `superRefine`
 * proves it is self-consistent; the test harness then proves the engine
 * agrees with it.
 */
export const ScenarioExpectationsSchema = z
  .strictObject({
    scenarioId: IdSchema,
    /** Why this scenario exists — which gap in gate coverage it fills. */
    teaches: z.string().min(1).max(500),
    policies: PolicyExpectationMapSchema,
    riskLevel: RiskLevelSchema,
    approvable: z.boolean(),
    /** Non-null only for approvable scenarios; asserts the sandbox outcome. */
    simulation: z
      .strictObject({ safetyPropertiesSatisfied: z.boolean() })
      .nullable(),
    /** Optional exact-set assertions on a finding's affected resources. */
    affectedResources: z.partialRecord(PolicyIdSchema, z.array(z.string().min(1))).optional(),
  })
  .superRefine((expectations, ctx) => {
    const statuses = Object.values(expectations.policies);
    const blocks = statuses.filter((status) => status === "BLOCK").length;
    const warns = statuses.filter((status) => status === "WARN").length;

    const derivedRisk =
      blocks > 0 ? "CRITICAL" : warns >= 2 ? "HIGH" : warns === 1 ? "MEDIUM" : "LOW";
    if (expectations.riskLevel !== derivedRisk) {
      ctx.addIssue({
        code: "custom",
        path: ["riskLevel"],
        message: `declared risk "${expectations.riskLevel}" contradicts the declared policy statuses (deterministic derivation gives "${derivedRisk}")`,
      });
    }

    const derivedApprovable = blocks === 0;
    if (expectations.approvable !== derivedApprovable) {
      ctx.addIssue({
        code: "custom",
        path: ["approvable"],
        message: derivedApprovable
          ? "a scenario with no BLOCK findings is approvable"
          : "a scenario with a BLOCK finding can never be approvable",
      });
    }

    if (!expectations.approvable && expectations.simulation !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "only approvable scenarios reach simulation",
      });
    }
    if (expectations.approvable && expectations.simulation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "approvable scenarios must declare their simulation outcome",
      });
    }
  });

// ---------------------------------------------------------------------------
// Analysis modes and replay fixtures
// ---------------------------------------------------------------------------

export const AnalysisModeSchema = z.enum(["live", "replay"]);

/**
 * Honest provenance labels. `captured_gpt_5_6` may only be used when fixture
 * metadata evidences a real capture (model + capture time). Authored fixtures
 * must never be attributed to GPT-5.6.
 */
export const FixtureProvenanceSchema = z.enum([
  "captured_gpt_5_6",
  "authored_red_team",
  "authored_synthetic",
]);

export const ReplayFixtureSchema = z
  .strictObject({
    fixtureId: IdSchema,
    scenarioId: IdSchema,
    provenance: FixtureProvenanceSchema,
    /** Required (non-null) when provenance is captured_gpt_5_6. */
    model: z.string().max(64).nullable(),
    capturedAtUtc: TimestampSchema.nullable(),
    notes: z.string().min(1).max(1000),
    proposal: ChangeProposalSchema,
  })
  .superRefine((fixture, ctx) => {
    if (fixture.provenance === "captured_gpt_5_6") {
      if (!fixture.model || !fixture.capturedAtUtc) {
        ctx.addIssue({
          code: "custom",
          path: ["provenance"],
          message:
            "captured_gpt_5_6 fixtures must evidence model and capturedAtUtc metadata",
        });
      }
    } else if (fixture.model !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "authored fixtures must not claim a model",
      });
    }
  });

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export const DiffEntrySchema = z.strictObject({
  op: ChangeOpKindSchema,
  path: StatePathSchema,
  before: JsonValueSchema.nullable(),
  after: JsonValueSchema.nullable(),
});

export const SimulationResultSchema = z.strictObject({
  status: z.literal("completed"),
  changedResourceIds: z.array(z.string().min(1).max(256)).min(1).max(64),
  diff: z.array(DiffEntrySchema).min(1).max(64),
  safetyProperties: z.array(
    z.strictObject({
      propertyId: IdSchema,
      satisfied: z.boolean(),
      detail: z.string().min(1).max(500),
    }),
  ),
  summary: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Change receipt
// ---------------------------------------------------------------------------

export const ReceiptDecisionSchema = z.enum(["approved", "rejected", "blocked"]);

export const ChangeReceiptSchema = z
  .strictObject({
    receiptId: IdSchema,
    incidentId: IdSchema,
    proposalId: IdSchema,
    scenarioId: IdSchema,
    appVersion: z.string().min(1).max(32),
    policyVersion: z.string().min(1).max(32),
    createdAtUtc: TimestampSchema,
    mode: AnalysisModeSchema,
    /** Runtime model for live analyses; null when replaying an authored fixture. */
    model: z.string().max(64).nullable(),
    fixtureProvenance: FixtureProvenanceSchema.nullable(),
    incidentSha256: Sha256HexSchema,
    proposalSha256: Sha256HexSchema,
    findings: z.array(PolicyFindingSchema).min(1).max(32),
    riskLevel: RiskLevelSchema,
    decision: ReceiptDecisionSchema,
    simulation: SimulationResultSchema.nullable(),
    /** SHA-256 of the canonical receipt content excluding this field. */
    receiptSha256: Sha256HexSchema,
  })
  .superRefine((receipt, ctx) => {
    if (receipt.mode === "live" && receipt.fixtureProvenance !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["fixtureProvenance"],
        message: "live receipts must not carry fixture provenance",
      });
    }
    if (receipt.mode === "replay" && receipt.fixtureProvenance === null) {
      ctx.addIssue({
        code: "custom",
        path: ["fixtureProvenance"],
        message: "replay receipts must declare fixture provenance",
      });
    }
    if (receipt.decision !== "approved" && receipt.simulation !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "only approved changes may carry a simulation result",
      });
    }
    if (receipt.decision === "approved" && receipt.simulation === null) {
      ctx.addIssue({
        code: "custom",
        path: ["simulation"],
        message: "approved receipts are issued only after simulation completes",
      });
    }
  });

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

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
export type ChangeOpKind = z.infer<typeof ChangeOpKindSchema>;
export type OperationValue = z.infer<typeof OperationValueSchema>;
export type RouteValue = z.infer<typeof RouteValueSchema>;
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;
export type VerificationStep = z.infer<typeof VerificationStepSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;
export type PolicyId = z.infer<typeof PolicyIdSchema>;
export type PolicyStatus = z.infer<typeof PolicyStatusSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type PolicyFinding = z.infer<typeof PolicyFindingSchema>;
export type PolicyExpectationMap = z.infer<typeof PolicyExpectationMapSchema>;
export type ScenarioExpectations = z.infer<typeof ScenarioExpectationsSchema>;
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
export type FixtureProvenance = z.infer<typeof FixtureProvenanceSchema>;
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
export type DiffEntry = z.infer<typeof DiffEntrySchema>;
export type SimulationResult = z.infer<typeof SimulationResultSchema>;
export type ReceiptDecision = z.infer<typeof ReceiptDecisionSchema>;
export type ChangeReceipt = z.infer<typeof ChangeReceiptSchema>;
