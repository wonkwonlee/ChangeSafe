import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * M4 experiment 10 (docs/M4_EXPERIMENT_10.md): the live run of a candidate
 * status-subresource guard, replayed from its raw artifact (checked against
 * its manifest hash), plus the checks that the candidate is a file of its
 * own and has not been adopted into the shipped routing guards.
 */

const dir = path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-f");
const manifest = z.object({ ciRun: z.string().url(), files: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
const raw = readFileSync(path.join(dir, "m4-status-guard-evidence.json"));
if (createHash("sha256").update(raw).digest("hex") !== manifest.files["m4-status-guard-evidence.json"]) {
  throw new Error("the guard artifact does not match its manifest hash");
}

const State = z.object({
  resourceVersion: z.string().nullable(),
  carrier: z.string().nullable(),
  replicas: z.number().nullable(),
  readyReplicas: z.number().nullable(),
  availableReplicas: z.number().nullable(),
  conditions: z.array(z.string()),
});
const Probe = z.object({ name: z.string(), exitStatus: z.number().nullable(), output: z.string(), after: State.nullable() });
const Evidence = z.object({
  guardApplied: z.string(),
  beforeGuard: State,
  statusAnnotation: Probe,
  statusHarmless: Probe,
  controllerBefore: State,
  controllerAfter: State,
  controllerEvents: z.array(z.object({
    type: z.string(), resourceVersion: z.string(), readyReplicas: z.number().nullable(),
    availableReplicas: z.number().nullable(), carrier: z.string().nullable(),
  })),
});
const evidence = Evidence.parse(JSON.parse(raw.toString("utf8")));

describe("M4-10 live evidence: what the candidate guard did", () => {
  it("was in force before the probes ran (a denied dry-run was waited for)", () => {
    expect(evidence.guardApplied).toBe("active=yes");
  });

  it("H10a: the status patch that sets the carrier is denied, naming the policy, and nothing moved", () => {
    const probe = evidence.statusAnnotation;
    expect(probe.exitStatus).not.toBe(0);
    expect(probe.exitStatus).not.toBeNull();
    expect(probe.output).toContain("ValidatingAdmissionPolicy 'changesafe-protected-status-annotations'");
    expect(probe.output).toContain("denied request");
    expect(probe.after?.resourceVersion).toBe(evidence.beforeGuard.resourceVersion);
    expect(probe.after?.carrier).toBe(evidence.beforeGuard.carrier);
  });

  it("H10c: a status write that leaves annotations alone is admitted and persists", () => {
    const probe = evidence.statusHarmless;
    expect(probe.exitStatus).toBe(0);
    expect(probe.after?.conditions).toContain("M4Probe:True");
    expect(probe.after?.resourceVersion).not.toBe(evidence.beforeGuard.resourceVersion);
    expect(probe.after?.carrier).toBe(evidence.beforeGuard.carrier);
  });

  it("H10b: the Deployment controller's own status writes went through while the guard was applied", () => {
    const { controllerBefore, controllerAfter, controllerEvents } = evidence;
    expect(Number(controllerAfter.resourceVersion)).toBeGreaterThan(Number(controllerBefore.resourceVersion));
    expect(controllerEvents.length).toBeGreaterThan(0);
    // The status moved: ready replicas dipped after the pod was deleted and recovered.
    const ready = controllerEvents.map(event => event.readyReplicas);
    expect(Math.min(...ready.filter((value): value is number => value !== null))).toBeLessThan(controllerBefore.readyReplicas ?? 0);
    expect(controllerAfter.readyReplicas).toBe(controllerBefore.readyReplicas);
    // And none of those writes touched the annotation, which the guard would have denied.
    expect(controllerEvents.every(event => event.carrier === controllerBefore.carrier)).toBe(true);
  });
});

describe("M4-10 the candidate is a candidate", () => {
  const candidate = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/m4-status-guard-candidate.yaml"), "utf8");
  const shipped = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/routing-guards.yaml"), "utf8");

  it("is its own file, scoped to protected namespaces and to the status subresources", () => {
    expect(candidate).toContain("changesafe.dev/tier");
    for (const resource of ["deployments/status", "statefulsets/status", "daemonsets/status", "services/status"]) {
      expect(candidate).toContain(resource);
    }
    expect(candidate).toContain("failurePolicy: Fail");
  });

  it("has not been adopted: the shipped routing guards name no status subresource and no such policy", () => {
    expect(shipped).not.toContain("/status");
    expect(shipped).not.toContain("changesafe-protected-status-annotations");
  });

  it("the harness applies it for the experiment and removes it before step 3", () => {
    const script = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/kind-repro.sh"), "utf8");
    const apply = script.indexOf("kubectl apply -f \"${EXAMPLE_DIR}/m4-status-guard-candidate.yaml\"");
    const remove = script.indexOf("kubectl delete -f \"${EXAMPLE_DIR}/m4-status-guard-candidate.yaml\"");
    const stepThree = script.indexOf("=== Demo step 3");
    expect(apply).toBeGreaterThan(0);
    expect(remove).toBeGreaterThan(apply);
    expect(stepThree).toBeGreaterThan(remove);
  });
});
