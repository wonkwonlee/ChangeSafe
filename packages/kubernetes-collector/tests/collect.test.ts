import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectKubernetesSnapshot, rejectCredentialPlugins, type ReadOnlyKubernetesClient } from "../src/index";

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../domain-kubernetes/tests/fixtures/current.snapshot.json"), "utf8")) as { resources: unknown[] };
function client(resources: unknown[] = fixture.resources): ReadOnlyKubernetesClient {
  const inNamespace = (namespace: string) => resources.filter((resource) => {
    const metadata = typeof resource === "object" && resource !== null && "metadata" in resource
      ? (resource as { metadata?: { namespace?: string } }).metadata
      : undefined;
    return (metadata?.namespace ?? "default") === namespace;
  });
  return {
    serverVersion: async () => "v1.31.0",
    listDeployments: async (namespace) => inNamespace(namespace),
    listStatefulSets: async () => [],
    listDaemonSets: async () => [],
    listServices: async () => [],
  };
}

describe("read-only Kubernetes collector", () => {
  it("deduplicates and sorts namespaces and produces a valid snapshot", async () => {
    const snapshot = await collectKubernetesSnapshot({
      namespaces: ["default", "demo", "default"],
      contextFingerprint: "fingerprint",
      now: () => "2026-07-29T00:00:00.000Z",
      maxResources: 2000,
    }, client());
    expect(snapshot.provenance.namespaces).toEqual(["default", "demo"]);
    expect(snapshot.resources).toHaveLength(2);
    expect(snapshot.provenance.source).toBe("cluster-api");
  });

  it("fails closed at the hard resource cap", async () => {
    await expect(collectKubernetesSnapshot({
      namespaces: ["demo"], contextFingerprint: "x", now: () => "2026-07-29T00:00:00.000Z", maxResources: 1,
    }, client([...fixture.resources, ...fixture.resources]))).rejects.toThrow(/resource limit/);
  });

  it("rejects credential plugins before any client is constructed", () => {
    expect(() => rejectCredentialPlugins({ users: [{ exec: { command: "credential-helper" } }] })).toThrow(/not supported/);
    expect(() => rejectCredentialPlugins({ users: [{ authProvider: { name: "oidc" } }] })).toThrow(/not supported/);
  });
});

describe("collector capability boundary", () => {
  it("contains no mutation, command execution, or watch capability", () => {
    const source = readFileSync(path.join(import.meta.dirname, "../src/client.ts"), "utf8") + readFileSync(path.join(import.meta.dirname, "../src/collect.ts"), "utf8");
    expect(source).not.toMatch(/\.(create|replace|patch|delete|deleteCollection|connect|exec|portForward|watch)[A-Z]/);
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("kubectl");
  });
});
