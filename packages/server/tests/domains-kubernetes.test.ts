import { describe, expect, it } from "vitest";
import { resolveServerDomain, SERVER_DOMAIN_IDS } from "../src/domains";

const SNAPSHOT = {
  snapshotVersion: "changesafe-kubernetes-snapshot/v1",
  snapshotId: "snap-test-0001",
  evidenceId: "ev-snap-test-0001",
  provenance: {
    source: "authored",
    collectedAtUtc: "2026-07-28T00:00:00.000Z",
    contextFingerprint: "context-test-0001",
    namespaces: ["default"],
    serverVersion: null,
  },
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "default" },
      spec: { replicas: 2 },
    },
  ],
};

const MANIFEST_TEXT = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 3
`;

describe("kubernetes server domain", () => {
  it("is registered", () => {
    expect(SERVER_DOMAIN_IDS).toContain("kubernetes");
  });

  it("parses a snapshot input and derives a proposal from manifest text", () => {
    const domain = resolveServerDomain("kubernetes");
    const { input, inputId } = domain.parseInput(SNAPSHOT);
    expect(inputId).toBe("snap-test-0001");

    const proposal = domain.resolveProposal(input, MANIFEST_TEXT);
    expect(proposal.operations.length).toBeGreaterThan(0);
  });

  it("rejects a non-string manifest body instead of casting it", () => {
    const domain = resolveServerDomain("kubernetes");
    const { input } = domain.parseInput(SNAPSHOT);
    expect(() => domain.resolveProposal(input, { not: "manifest text" })).toThrow();
  });

  it("simulates", () => {
    const domain = resolveServerDomain("kubernetes");
    const { input } = domain.parseInput(SNAPSHOT);
    const proposal = domain.resolveProposal(input, MANIFEST_TEXT);
    expect(domain.simulate).toBeDefined();
    const result = domain.simulate!(input, proposal);
    expect(result).toBeDefined();
  });
});
