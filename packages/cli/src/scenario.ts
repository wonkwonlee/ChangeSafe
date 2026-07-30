import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ScenarioExpectationsSchema,
  evaluatePolicies,
  policyOrder,
  validateProposalEvidence,
  type ChangeProposal,
  type PolicyStatus,
} from "@changesafe/core";

import { resolveDomain } from "./domains";
import { UsageError, parseOrThrow, readJsonFile } from "./io";
import { EXIT_BLOCKED, EXIT_OK, paint, type Console } from "./output";

const REQUIRED_FILES = ["incident.json", "expectations.json"];

export interface ScenarioCheckOptions {
  dir: string;
  domain: string;
  format: "pretty" | "json";
}

interface ScenarioResult {
  scenarioId: string;
  ok: boolean;
  problems: string[];
}

/**
 * Run every scenario in a directory against its declared expectations —
 * the same contract the repository's test harness enforces, available to
 * contributors without running the whole suite.
 */
export function runScenarioCheck(options: ScenarioCheckOptions, console: Console): number {
  const domain = resolveDomain(options.domain);
  const root = path.resolve(options.dir);
  if (!existsSync(root)) {
    throw new UsageError(`scenario directory does not exist: ${root}`);
  }

  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(root, name, "expectations.json")))
    .sort();

  if (directories.length === 0) {
    throw new UsageError(`no scenarios found in ${root}`);
  }

  const results = directories.map((name) => checkOne(path.join(root, name), domain));
  const ok = results.every((result) => result.ok);

  if (options.format === "json") {
    console.out(JSON.stringify({ ok, scenarios: results }, null, 2));
    return ok ? EXIT_OK : EXIT_BLOCKED;
  }

  console.out("");
  for (const result of results) {
    const mark = result.ok
      ? paint(console.color, "green", "ok  ")
      : paint(console.color, "red", "FAIL");
    console.out(`  ${mark}  ${result.scenarioId}`);
    for (const problem of result.problems) {
      console.out(`        ${paint(console.color, "dim", problem)}`);
    }
  }
  console.out("");
  console.out(
    ok
      ? `  ${paint(console.color, "green", `${results.length} scenario(s) match their declared expectations`)}`
      : `  ${paint(console.color, "red", "some scenarios do not match their declared expectations")}`,
  );
  console.out("");
  return ok ? EXIT_OK : EXIT_BLOCKED;
}

function checkOne(dir: string, domain: ReturnType<typeof resolveDomain>): ScenarioResult {
  const scenarioId = path.basename(dir);
  const problems: string[] = [];

  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(dir, file))) {
      return { scenarioId, ok: false, problems: [`missing ${file}`] };
    }
  }
  if (!domain.derivesProposalFromInput && !existsSync(path.join(dir, "replay-fixture.json"))) {
    return { scenarioId, ok: false, problems: ["missing replay-fixture.json"] };
  }

  try {
    const rawIncident = readJsonFile(path.join(dir, "incident.json"), "incident");
    const { context, ...incident } = rawIncident as {
      context?: { kind: string; text: string }[];
    } & Record<string, unknown>;
    const { input } = domain.parseInput(incident, context);
    // External-diff domains (terraform) derive the proposal from the input
    // itself — the plan already says what will change — so there is no
    // separate fixture file to parse, unlike a simulated-state domain.
    const proposal = domain.derivesProposalFromInput
      ? domain.deriveProposal?.(input)
      : domain.parseProposal(
          readJsonFile(path.join(dir, "replay-fixture.json"), "fixture"),
          input,
        ).proposal;
    if (!proposal) {
      throw new UsageError(`the ${domain.id} domain could not derive a proposal from the input`);
    }
    const expectations = parseOrThrow(
      ScenarioExpectationsSchema,
      readJsonFile(path.join(dir, "expectations.json"), "expectations"),
      "expectations",
    );

    if (expectations.scenarioId !== scenarioId) {
      problems.push(
        `expectations declare "${expectations.scenarioId}" but the directory is "${scenarioId}"`,
      );
    }

    validateProposalEvidence(domain.adapter, input as never, proposal as ChangeProposal);

    const { findings, riskLevel } = evaluatePolicies(
      domain.adapter,
      input as never,
      proposal as ChangeProposal,
    );

    const declared = Object.keys(expectations.policies).sort();
    const produced = [...policyOrder(domain.adapter)].sort();
    if (declared.join(",") !== produced.join(",")) {
      problems.push(
        `declares ${declared.length} policies, this domain evaluates ${produced.length} (${produced.join(", ")})`,
      );
    }

    for (const finding of findings) {
      const expected: PolicyStatus | undefined = expectations.policies[finding.policyId];
      if (expected && expected !== finding.status) {
        problems.push(
          `${finding.policyId}: expected ${expected}, got ${finding.status} — ${finding.explanation}`,
        );
      }
    }

    if (riskLevel !== expectations.riskLevel) {
      problems.push(`risk: expected ${expectations.riskLevel}, got ${riskLevel}`);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "unexpected failure");
  }

  return { scenarioId, ok: problems.length === 0, problems };
}

/** Scaffold a new scenario directory the harness will pick up. */
export function runScenarioInit(
  options: { name: string; dir: string },
  console: Console,
): number {
  const scenarioId = options.name;
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scenarioId)) {
    throw new UsageError(`scenario name must be lowercase kebab-case, got "${scenarioId}"`);
  }

  const dir = path.resolve(options.dir, scenarioId);
  if (existsSync(dir)) {
    throw new UsageError(`scenario already exists: ${dir}`);
  }
  mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(dir, "incident.json"), `${JSON.stringify(incidentTemplate(), null, 2)}\n`);
  writeFileSync(
    path.join(dir, "replay-fixture.json"),
    `${JSON.stringify(fixtureTemplate(scenarioId), null, 2)}\n`,
  );
  writeFileSync(
    path.join(dir, "expectations.json"),
    `${JSON.stringify(expectationsTemplate(scenarioId), null, 2)}\n`,
  );

  console.out("");
  console.out(`  created ${path.relative(process.cwd(), dir)}`);
  console.out("");
  console.out("  Next:");
  console.out("    1. Replace the placeholder incident and proposal with your scenario.");
  console.out("    2. Run `changesafe scenario check` and write down what actually happened.");
  console.out("    3. Register it in scenarios/index.ts so the app and harness see it.");
  console.out("");
  console.out("  Authoring guide: docs/SCENARIO_AUTHORING.md");
  console.out("");
  return EXIT_OK;
}

function incidentTemplate() {
  return {
    incidentId: "inc-example-0001",
    title: "Describe the situation, never the verdict",
    summary: "What is happening, on which synthetic devices. All data must be fictional.",
    alerts: [
      {
        evidenceId: "ev-alert-example",
        timestamp: "2026-01-01T00:00:00Z",
        severity: "critical",
        sourceNodeId: "edge-rtr-01",
        message: "Replace with a realistic alert message",
      },
    ],
    operatorNotes: [],
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
          interfaces: { eth0: { id: "eth0", name: "eth0", enabled: true, status: "up" } },
          routes: {},
          routing: { preferences: {} },
        },
        "edge-rtr-01": {
          id: "edge-rtr-01",
          name: "Edge Router 01",
          role: "edge-router",
          protected: false,
          interfaces: { mgmt0: { id: "mgmt0", name: "mgmt0", enabled: true, status: "up" } },
          routes: {
            "rt-mgmt": {
              id: "rt-mgmt",
              destination: "192.0.2.0/24",
              nextHop: "direct",
              metric: 0,
              kind: "connected",
              protected: true,
              description: "Connected management subnet",
            },
            "rt-example": {
              id: "rt-example",
              destination: "198.51.100.0/24",
              nextHop: "203.0.113.1",
              metric: 50,
              kind: "static",
              protected: false,
              description: "The route your proposal will change",
            },
          },
          routing: { preferences: {} },
        },
      },
      management: { originNodeId: "mgmt-01", protectedTargetNodeIds: ["edge-rtr-01"] },
    },
    expectedSafetyProperties: [
      {
        id: "sp-mgmt-reach",
        description: "The management station keeps reachability to every protected device",
        check: { type: "mgmt-reachability" },
      },
    ],
  };
}

function fixtureTemplate(scenarioId: string) {
  return {
    fixtureId: `fix-${scenarioId}`,
    scenarioId,
    provenance: "authored_synthetic",
    model: null,
    capturedAtUtc: null,
    notes: "Authored fixture. Say plainly what this is and what it demonstrates. Not model output.",
    proposal: {
      proposalId: `prop-${scenarioId}`,
      summary: "What the change does, in one sentence.",
      diagnosis: {
        likelyCause: "Why the incident is happening, grounded in the cited evidence.",
        confidence: 0.7,
        evidenceIds: ["ev-alert-example"],
        assumptions: ["State anything the diagnosis takes for granted"],
      },
      operations: [
        {
          op: "replace",
          path: "/devices/edge-rtr-01/routes/rt-example/metric",
          value: 150,
          reason: "Why this specific operation addresses the cause",
          evidenceIds: ["ev-alert-example"],
        },
      ],
      rollbackOperations: [
        {
          op: "replace",
          path: "/devices/edge-rtr-01/routes/rt-example/metric",
          value: 50,
          reason: "Restore the original metric",
          evidenceIds: ["ev-alert-example"],
        },
      ],
      verificationSteps: [
        {
          kind: "precondition",
          description: "What must be true before the change",
          evidenceIds: [],
        },
        {
          kind: "postcheck",
          description: "How success is confirmed after the change",
          evidenceIds: [],
        },
      ],
    },
  };
}

function expectationsTemplate(scenarioId: string) {
  return {
    scenarioId,
    teaches: "What this scenario shows that no existing scenario does. Run the check, then write the truth here.",
    policies: {
      PATCH_SCHEMA: "PASS",
      MGMT_REACHABILITY: "PASS",
      PROTECTED_RESOURCE: "PASS",
      BLAST_RADIUS: "PASS",
      ROLLBACK_COMPLETE: "PASS",
      VERIFICATION_REQUIRED: "PASS",
      UNTRUSTED_INSTRUCTION: "PASS",
    },
    riskLevel: "LOW",
    approvable: true,
    simulation: { safetyPropertiesSatisfied: true },
    // Where this sits in the corpus. Set `adversarial` to true and name the
    // failure modes it exercises if the proposal is built to get an unsafe
    // change past a reviewer; see docs/SCENARIOS.md for the taxonomy and
    // which modes still have no coverage.
    corpus: {
      adversarial: false,
      failureModes: [],
    },
  };
}
