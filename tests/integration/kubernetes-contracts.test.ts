import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../packages/cli/src/main";
import { runKubernetesCollect } from "../../packages/cli/src/kubernetes-collect";
import type { Console } from "../../packages/cli/src/output";

const root = path.resolve(import.meta.dirname, "../..");
const fixture = (name: string) => path.join(root, "packages/cli/tests/fixtures/kubernetes", name);
function capture(): Console & { stdout: string; stderr: string } {
  const out: string[] = []; const err: string[] = [];
  return { color: false, out: (line) => out.push(line), err: (line) => err.push(line), get stdout() { return out.join("\n"); }, get stderr() { return err.join("\n"); } };
}

describe("Kubernetes offline CLI contract", () => {
  it("gates a YAML upsert without contacting a cluster", async () => {
    const c = capture();
    const code = await main(["gate", "--domain", "kubernetes", "--input", fixture("current.snapshot.json"), "--proposal", fixture("safe-update.yaml"), "--format", "json"], c);
    expect(code).toBe(0);
    expect(JSON.parse(c.stdout)).toMatchObject({ domain: "kubernetes", decision: "gate_only" });
  });

  it("blocks a privileged workload", async () => {
    const c = capture();
    const code = await main(["gate", "--domain", "kubernetes", "--input", fixture("current.snapshot.json"), "--proposal", fixture("privileged-update.yaml"), "--format", "json"], c);
    expect(code).toBe(1);
    expect(c.stdout).toContain("K8S_PRIVILEGE_ESCALATION");
  });

  it("rejects unsupported manifest kinds with evaluation failure", async () => {
    const c = capture();
    await expect(main(["gate", "--domain", "kubernetes", "--input", fixture("current.snapshot.json"), "--proposal", fixture("unsupported-secret.yaml"), "--format", "json"], c)).rejects.toThrow(/unsupported/);
  });

  it("keeps the proposal boundary free of credentials", () => {
    expect(readFileSync(fixture("unsupported-secret.yaml"), "utf8")).not.toMatch(/real|token-[A-Za-z0-9]/);
  });
});

describe("Kubernetes collector CLI boundary", () => {
  it("preserves an existing output and sanitizes API failures", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "changesafe-k8s-"));
    const output = path.join(directory, "snapshot.json");
    writeFileSync(output, "existing\n");
    const failingClient = {
      serverVersion: async () => "v1.31.0",
      listDeployments: async () => { throw new Error("403 forbidden: token super-secret"); },
      listStatefulSets: async () => [],
      listDaemonSets: async () => [],
      listServices: async () => [],
    };
    await expect(runKubernetesCollect({
      namespaces: ["demo"],
      out: output,
      client: failingClient,
      now: () => "2026-07-29T00:00:00.000Z",
    }, capture())).rejects.toThrow("Kubernetes collection failed (authorization).");
    expect(readFileSync(output, "utf8")).toBe("existing\n");
  });
});
