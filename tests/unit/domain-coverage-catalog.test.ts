import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChangeProposalSchema,
  type DomainAdapter,
} from "@changesafe/core";

import { DomainCoverageCatalog } from "@/components/DomainCoverageCatalog";
import {
  DOMAIN_REGISTRY,
  defineDomainRegistry,
  type LoadedDomainCoverageCatalog,
} from "@/features/domains/registry";
import { defineDomainPresentation } from "@/features/domains/presentation";
import { REVIEW_CONTRACT_VERSION } from "@/features/domains/review-contract";
import { defineSimulatedRuntime } from "@/features/domains/runtime";

const FutureInputSchema = z.strictObject({
  inputId: z.literal("future-input"),
  evidenceId: z.literal("ev-future-001"),
  currentValue: z.boolean(),
});
type FutureInput = z.infer<typeof FutureInputSchema>;

const futureAdapter: DomainAdapter<FutureInput, FutureInput> = {
  domainId: "future-example",
  policyVersion: "future-v1",
  stateOf: (input) => input,
  applyOperations: (state) => ({ nextState: structuredClone(state), diff: [] }),
  blastRadiusUnit: () => ({ kind: "future-resource", id: "future-input" }),
  untrustedTexts: () => [],
  knownEvidenceIds: (input) => new Set([input.evidenceId]),
  policies: [
    {
      id: "FUTURE_POLICY",
      evaluate: () => ({
        policyId: "FUTURE_POLICY",
        status: "PASS",
        title: "Future policy",
        explanation: "The generic fourth-domain policy reached a verdict.",
        affectedResources: [],
        remediation: null,
      }),
    },
  ],
};

const futureCapabilities = {
  sandboxSimulation: true,
  resourceGraph: false,
  structuredDiff: true,
  untrustedContext: false,
} as const;

const futurePresentation = defineDomainPresentation({
  domainId: "future-example",
  contractVersion: REVIEW_CONTRACT_VERSION,
  domainShape: "simulated-state",
  capabilities: futureCapabilities,
  label: "Future example",
  description: "Test-only fourth-domain registration.",
});

const futureRegistry = defineDomainRegistry([
  {
    metadata: futurePresentation,
    async load() {
      return {
        runtime: defineSimulatedRuntime({
          domainId: "future-example",
          contractVersion: REVIEW_CONTRACT_VERSION,
          capabilities: futureCapabilities,
          inputSchema: FutureInputSchema,
          proposalSchema: ChangeProposalSchema,
          adapter: futureAdapter,
          simulate: () => ({
            status: "completed",
            changedResourceIds: [],
            diff: [],
            safetyProperties: [],
            summary: "Only a deep-cloned test state was inspected.",
          }),
          limitations: [
            "Test-only registration; no production identity or infrastructure integration exists.",
          ],
        }),
        presentation: futurePresentation,
      };
    },
  },
]);

const futureProposal = ChangeProposalSchema.parse({
  proposalId: "future-proposal",
  summary: "Change one generic resource.",
  diagnosis: {
    likelyCause: "The generic value is stale.",
    confidence: 0.8,
    evidenceIds: ["ev-future-001"],
    assumptions: [],
  },
  operations: [
    {
      op: "replace",
      path: "/resources/future-input",
      value: { enabled: true },
      reason: "Restore the generic value.",
      evidenceIds: ["ev-future-001"],
    },
  ],
  rollbackOperations: [
    {
      op: "replace",
      path: "/resources/future-input",
      value: { enabled: false },
      reason: "Restore the prior generic value.",
      evidenceIds: ["ev-future-001"],
    },
  ],
  verificationSteps: [
    {
      kind: "precondition",
      description: "Confirm the generic resource exists.",
      evidenceIds: ["ev-future-001"],
    },
    {
      kind: "postcheck",
      description: "Confirm the generic value is visible.",
      evidenceIds: [],
    },
  ],
});

describe("generic domain coverage fallback", () => {
  it("keeps the documented fourth-domain path aligned with the runtime contracts", async () => {
    const template = await readFile(
      path.join(process.cwd(), "docs/FUTURE_DOMAIN_TEMPLATE.md"),
      "utf8",
    );

    expect(template).toContain("defineSimulatedRuntime");
    expect(template).toContain("defineExternalDiffRuntime");
    expect(template).toContain("defineDomainPresentation");
    expect(template).toContain("DOMAIN_REGISTRY");
    expect(template).toContain("DomainCoverageCatalog.tsx");
    expect(template).toContain("future-example");
    expect(template).toContain("Production IAM remains unsupported");
  });

  it("renders a test-only fourth domain without changing the generic catalog", async () => {
    const resolution = futureRegistry.resolve(
      "future-example",
      REVIEW_CONTRACT_VERSION,
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const entry = await resolution.load();
    const evaluation = entry.runtime.evaluate(
      {
        inputId: "future-input",
        evidenceId: "ev-future-001",
        currentValue: false,
      },
      futureProposal,
    );
    const catalog: LoadedDomainCoverageCatalog = {
      registration: resolution.metadata,
      runtime: {
        domainId: entry.runtime.domainId,
        contractVersion: entry.runtime.contractVersion,
        domainShape: entry.runtime.domainShape,
        policyVersion: entry.runtime.policyVersion,
        capabilities: entry.runtime.capabilities,
        policyCoverage: entry.runtime.policyCoverage,
      },
    };

    const markup = renderToStaticMarkup(
      createElement(DomainCoverageCatalog, {
        catalog,
        evaluatedPolicyIds: evaluation.findings.map(
          (finding) => finding.policyId,
        ),
        simulationDisclosure:
          "The test runtime supports clone-only simulation; none ran in this catalog render.",
        source: {
          sourceId: "future-source",
          source: "authored-fixture",
          analysisMode: "replay",
          provenance: "authored-synthetic",
        },
      }),
    );

    expect(markup).toContain('data-domain-coverage="future-example"');
    expect(markup).toContain("Registered metadata");
    expect(markup).toContain("Loaded deterministic coverage");
    expect(markup).toContain("FUTURE_POLICY");
    expect(markup).toContain("evaluated · finding returned");
    expect(markup).toContain("authored-synthetic");
    expect(markup).toContain("bundled authored fixture");
    expect(markup).toContain("Infrastructure write");
    expect(markup).toContain("unavailable");
    expect(markup).toContain(
      "no production identity or infrastructure integration exists",
    );
  });

  it("does not widen the production registry for an unknown future domain", () => {
    expect(
      DOMAIN_REGISTRY.resolve("future-example", REVIEW_CONTRACT_VERSION),
    ).toEqual({
      ok: false,
      error: {
        code: "UNKNOWN_DOMAIN",
        domainId: "future-example",
      },
    });
  });
});
