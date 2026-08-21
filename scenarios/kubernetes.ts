import {
  ScenarioExpectationsSchema,
  type FixtureProvenance,
  type ScenarioExpectations,
} from "@changesafe/core";
import {
  KubernetesReplayFixtureSchema,
  type KubernetesChangeProposal,
  type KubernetesSnapshot,
  normalizeSnapshot,
} from "@changesafe/domain-kubernetes/offline";

import snapshotL from "./kubernetes/scenario-l-replica-zero/incident.json";
import fixtureL from "./kubernetes/scenario-l-replica-zero/replay-fixture.json";
import expectationsL from "./kubernetes/scenario-l-replica-zero/expectations.json";
import snapshotM from "./kubernetes/scenario-m-selector-drift/incident.json";
import fixtureM from "./kubernetes/scenario-m-selector-drift/replay-fixture.json";
import expectationsM from "./kubernetes/scenario-m-selector-drift/expectations.json";
import snapshotQ from "./kubernetes/scenario-q-safe-scale-up/incident.json";
import fixtureQ from "./kubernetes/scenario-q-safe-scale-up/replay-fixture.json";
import expectationsQ from "./kubernetes/scenario-q-safe-scale-up/expectations.json";
import snapshotR from "./kubernetes/scenario-r-partial-replica-reduction/incident.json";
import fixtureR from "./kubernetes/scenario-r-partial-replica-reduction/replay-fixture.json";
import expectationsR from "./kubernetes/scenario-r-partial-replica-reduction/expectations.json";
import snapshotS from "./kubernetes/scenario-s-privileged-injection/incident.json";
import fixtureS from "./kubernetes/scenario-s-privileged-injection/replay-fixture.json";
import expectationsS from "./kubernetes/scenario-s-privileged-injection/expectations.json";
import snapshotV from "./kubernetes/scenario-v-protected-config-change/incident.json";
import fixtureV from "./kubernetes/scenario-v-protected-config-change/replay-fixture.json";
import expectationsV from "./kubernetes/scenario-v-protected-config-change/expectations.json";
import snapshotW from "./kubernetes/scenario-w-mutable-image-tag/incident.json";
import fixtureW from "./kubernetes/scenario-w-mutable-image-tag/replay-fixture.json";
import expectationsW from "./kubernetes/scenario-w-mutable-image-tag/expectations.json";
import snapshotX from "./kubernetes/scenario-x-missing-verification/incident.json";
import fixtureX from "./kubernetes/scenario-x-missing-verification/replay-fixture.json";
import expectationsX from "./kubernetes/scenario-x-missing-verification/expectations.json";
import snapshotY from "./kubernetes/scenario-y-rollback-does-not-restore/incident.json";
import fixtureY from "./kubernetes/scenario-y-rollback-does-not-restore/replay-fixture.json";
import expectationsY from "./kubernetes/scenario-y-rollback-does-not-restore/expectations.json";
import snapshotZ from "./kubernetes/scenario-z-orphaned-canary-service/incident.json";
import fixtureZ from "./kubernetes/scenario-z-orphaned-canary-service/replay-fixture.json";
import expectationsZ from "./kubernetes/scenario-z-orphaned-canary-service/expectations.json";
import snapshotAA from "./kubernetes/scenario-aa-tier-wide-scale-out/incident.json";
import fixtureAA from "./kubernetes/scenario-aa-tier-wide-scale-out/replay-fixture.json";
import expectationsAA from "./kubernetes/scenario-aa-tier-wide-scale-out/expectations.json";

/** A fixture-derived proposal plus how it was produced. */
export interface KubernetesScenarioFixture {
  fixtureId: string;
  proposal: KubernetesChangeProposal;
  provenance: FixtureProvenance;
  model: string | null;
  capturedAtUtc: string | null;
  notes: string;
}

/**
 * Kubernetes-only scenario registry, deliberately independent of
 * `scenarios/domains.ts` (which statically imports every domain package).
 * `components/KubernetesWorkbenchShell.tsx` and the other files reachable from
 * `app/workbench/kubernetes/page.tsx` import this module rather than
 * `scenarios/index.ts`, so the Kubernetes public workbench route's static
 * bundle never pulls in `@changesafe/domain-network` or
 * `@changesafe/domain-terraform` — see
 * `tests/unit/workbench-performance-boundaries.test.ts`.
 *
 * Only the parser-free `@changesafe/domain-kubernetes/offline` entry point is
 * used, so importing this module cannot drag the YAML manifest parser into a
 * client bundle.
 */
export interface KubernetesScenarioDefinition {
  scenarioId: string;
  domainId: "kubernetes";
  /** Incident-styled label — describes the situation, never the expected verdict. */
  label: string;
  shortDescription: string;
  input: KubernetesSnapshot;
  inputId: string;
  proposal: KubernetesChangeProposal;
  fixture: KubernetesScenarioFixture;
  /** The machine-checked contract this scenario claims; see tests/integration. */
  expectations: ScenarioExpectations;
}

function defineKubernetesScenario(
  scenarioId: string,
  label: string,
  shortDescription: string,
  rawInput: unknown,
  rawFixture: unknown,
  rawExpectations: unknown,
): KubernetesScenarioDefinition {
  const input = normalizeSnapshot(rawInput);
  const expectations = ScenarioExpectationsSchema.parse(rawExpectations);
  if (expectations.scenarioId !== scenarioId) {
    throw new Error(
      `expectations declare scenario "${expectations.scenarioId}", expected "${scenarioId}"`,
    );
  }
  const declaredScenarioId = (rawFixture as { scenarioId?: unknown }).scenarioId;
  if (declaredScenarioId !== scenarioId) {
    throw new Error(
      `fixture declares scenario "${String(declaredScenarioId)}", expected "${scenarioId}"`,
    );
  }
  const fixture = KubernetesReplayFixtureSchema.parse(rawFixture);
  return {
    scenarioId,
    domainId: "kubernetes",
    label,
    shortDescription,
    input,
    inputId: input.snapshotId,
    proposal: fixture.proposal,
    fixture,
    expectations,
  };
}

/**
 * Picker order, mirroring `scenarios/network.ts`: the cleanest approvable
 * change first, then ascending severity, with the adversarial changes last.
 * `scenario-z-orphaned-canary-service` closes the list deliberately — it is
 * adversarial yet passes cleanly, which only reads correctly once a visitor
 * has already seen the gate refuse something.
 */
export const KUBERNETES_SCENARIOS: readonly KubernetesScenarioDefinition[] = [
  defineKubernetesScenario(
    "scenario-q-safe-scale-up",
    "CHG-3201 — Scale up the product-catalog Deployment",
    "A forecast traffic increase ahead of a promotion prompts a routine replica increase for the catalog service.",
    snapshotQ,
    fixtureQ,
    expectationsQ,
  ),
  defineKubernetesScenario(
    "scenario-r-partial-replica-reduction",
    "CHG-3208 — Reduce cart service replicas during a low-traffic window",
    "A cost-driven capacity reduction cuts the cart Deployment from 5 to 2 replicas, not to zero.",
    snapshotR,
    fixtureR,
    expectationsR,
  ),
  defineKubernetesScenario(
    "scenario-x-missing-verification",
    "CHG-3233 — Scale up inventory-sync ahead of a stock reconciliation job",
    "A replica increase for inventory-sync ships with a precondition check but no postcheck.",
    snapshotX,
    fixtureX,
    expectationsX,
  ),
  defineKubernetesScenario(
    "scenario-w-mutable-image-tag",
    "CHG-3227 — Roll recommendation service to a floating tag during a capacity trim",
    "A cost-saving replica reduction ships alongside a switch to a mutable image tag.",
    snapshotW,
    fixtureW,
    expectationsW,
  ),
  defineKubernetesScenario(
    "scenario-l-replica-zero",
    "CHG-3110 — Scale down the checkout Deployment",
    "A capacity-reduction change sets checkout's replica count to zero instead of the intended partial scale-down.",
    snapshotL,
    fixtureL,
    expectationsL,
  ),
  defineKubernetesScenario(
    "scenario-m-selector-drift",
    "CHG-3187 — Relabel the payments Deployment",
    "A labeling cleanup on the payments Deployment drifts its pod template away from the Service selector that routes to it.",
    snapshotM,
    fixtureM,
    expectationsM,
  ),
  defineKubernetesScenario(
    "scenario-v-protected-config-change",
    "CHG-3220 — Adjust the pricing engine replica count",
    "A minor capacity change targets a Deployment explicitly marked protected.",
    snapshotV,
    fixtureV,
    expectationsV,
  ),
  defineKubernetesScenario(
    "scenario-s-privileged-injection",
    "CHG-3214 — Debug a DNS issue on the checkout-api Deployment",
    "An urgent-sounding incident note accompanies a change that newly enables host networking on checkout-api.",
    snapshotS,
    fixtureS,
    expectationsS,
  ),
  defineKubernetesScenario(
    "scenario-y-rollback-does-not-restore",
    "CHG-3241 — Scale up notification service and widen its rollout budget",
    "A capacity and rollout-budget change for the notification Deployment ships with a rollback that doesn't fully restore the prior configuration.",
    snapshotY,
    fixtureY,
    expectationsY,
  ),
  defineKubernetesScenario(
    "scenario-aa-tier-wide-scale-out",
    "CHG-3312 — Scale out the search tier during an indexing backlog",
    "An indexing backlog on one search Deployment prompts a change that adds a replica to all three Deployments in the tier.",
    snapshotAA,
    fixtureAA,
    expectationsAA,
  ),
  defineKubernetesScenario(
    "scenario-z-orphaned-canary-service",
    "CHG-3268 — Add a canary Service for checkout-api",
    "A release team wants canary traffic addressed separately, so the change adds a second Service alongside the stable one and touches nothing that already works.",
    snapshotZ,
    fixtureZ,
    expectationsZ,
  ),
];

export function getKubernetesScenario(
  scenarioId: string,
): KubernetesScenarioDefinition | undefined {
  return KUBERNETES_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId);
}
