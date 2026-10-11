import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * M4 experiment 10 (docs/M4_EXPERIMENT_10.md): the live run of a candidate
 * status-subresource guard, replayed from its raw artifact (checked against
 * its manifest hash), plus the checks that the candidate is a file of its
 * own and has not been adopted into the shipped routing guards.
 */

const dir = path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-g");
const manifest = z.object({ ciRun: z.string().url(), files: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
const raw = readFileSync(path.join(dir, "m4-status-guard-evidence.json"));
if (createHash("sha256").update(raw).digest("hex") !== manifest.files["m4-status-guard-evidence.json"]) {
  throw new Error("the guard artifact does not match its manifest hash");
}

const State = z.object({
  resourceVersion: z.string().nullable(),
  carrier: z.string().nullable(),
  annotations: z.record(z.string(), z.string()).optional(),
  replicas: z.number().nullable(),
  readyReplicas: z.number().nullable(),
  availableReplicas: z.number().nullable(),
  conditions: z.array(z.string()),
});
const Probe = z.object({
  name: z.string(), exitStatus: z.number().nullable(), output: z.string(), after: State.nullable(),
  // Present in artifacts produced after review; the committed one predates it.
  httpStatus: z.number().nullable().optional(),
});
const Evidence = z.object({
  guardApplied: z.string(),
  controllerReacted: z.string().optional(),
  beforeGuard: State,
  statusAnnotation: Probe,
  statusHarmless: Probe,
  controllerBefore: State,
  controllerAfter: State,
  controllerEvents: z.array(z.object({
    type: z.string(), resourceVersion: z.string(), readyReplicas: z.number().nullable(),
    availableReplicas: z.number().nullable(), carrier: z.string().nullable(),
    // Present in artifacts produced after review; the committed one predates it.
    annotations: z.record(z.string(), z.string()).optional(),
  })),
});
const evidence = Evidence.parse(JSON.parse(raw.toString("utf8")));

describe("M4-10 live evidence: what the candidate guard did", () => {
  it("was in force before the probes ran (a dry-run refused by the policy by name was waited for), and the controller was seen to react", () => {
    expect(evidence.guardApplied).toBe("active=yes");
    expect(evidence.controllerReacted).toBe("reacted=yes");
  });

  it("H10a: the status patch that sets the carrier is denied, naming the policy, and nothing moved", () => {
    const probe = evidence.statusAnnotation;
    expect(probe.exitStatus).not.toBe(0);
    expect(probe.exitStatus).not.toBeNull();
    expect(probe.output).toContain("ValidatingAdmissionPolicy 'changesafe-protected-status-annotations'");
    expect(probe.output).toContain("denied request");
    // The status code was not captured in this artifact (the verbose-log
    // parser did not match kubectl's structured format; it does now).
    expect(probe.httpStatus ?? null).toBeNull();
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
    const before = controllerBefore.readyReplicas;
    expect(before).not.toBeNull();
    const ready = controllerEvents.map(event => event.readyReplicas).filter((value): value is number => value !== null);
    expect(ready.length).toBeGreaterThan(0);
    expect(Math.min(...ready)).toBeLessThan(before as number);
    expect(controllerAfter.readyReplicas).toBe(before);
    // None of those events changed the carrier, and none changed any other
    // annotation: this artifact records every annotation of every event, so
    // the guard's one predicate ("annotations differ") held on each of them.
    expect(controllerEvents.every(event => event.carrier === controllerBefore.carrier)).toBe(true);
    expect(controllerEvents.every(event => event.annotations !== undefined)).toBe(true);
    const first = controllerEvents[0]?.annotations;
    expect(first).toBeDefined();
    for (const event of controllerEvents) expect(event.annotations).toEqual(first);
    expect(controllerBefore.annotations).toEqual(first);
  });
});

describe("M4-10 the candidate is a candidate", () => {
  const candidate = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/m4-status-guard-candidate.yaml"), "utf8");
  const shipped = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/routing-guards.yaml"), "utf8");

  it("is its own file, scoped to protected namespaces and to the status subresources", () => {
    // Anchored to the lines that carry the meaning, not to any occurrence of a
    // word: a resource in a "resources:" list, the tier selector under the
    // binding's namespaceSelector, and the comparison in the expression.
    const resourceLists = [...candidate.matchAll(/^\s*resources:\s*\[([^\]]*)\]/gm)].map(match => match[1] ?? "");
    const named = resourceLists.join(",");
    for (const resource of ["deployments/status", "statefulsets/status", "daemonsets/status", "services/status"]) {
      expect(named).toContain(`"${resource}"`);
    }
    expect(/namespaceSelector:\s*\n\s*matchLabels:\s*\n\s*changesafe\.dev\/tier:\s*protected/.test(candidate)).toBe(true);
    expect(candidate).toContain("failurePolicy: Fail");
    expect(candidate).toContain("operations: [\"UPDATE\"]");
    // The comparison is between the new and the old annotations, guarded by has().
    const expression = candidate.slice(candidate.indexOf("expression:"), candidate.indexOf("message:"));
    expect(expression).toContain("object.metadata.annotations == oldObject.metadata.annotations");
    expect(expression).toContain("has(object.metadata.annotations)");
    expect(expression).toContain("has(oldObject.metadata.annotations)");
  });

  it("has not been adopted: the shipped routing guards name no status subresource and no such policy anywhere in their live lines", () => {
    // Comments are stripped so a mention in prose is not an adoption and a
    // block-style or differently formatted list cannot hide one.
    const live = shipped.split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
    expect(live).not.toContain("/status");
    expect(live).not.toContain("changesafe-protected-status-annotations");
  });

  it("the webhook, the candidate guard and the audit policy list the same kinds' status subresources", () => {
    // The three lists name subresources separately, and a kind added to one
    // and not the others reopens the path unseen. Every kind the shipped
    // protected webhook registers must have <kind>/status in the guard and
    // in the audit policy.
    const resourcesIn = (text: string) =>
      [...text.matchAll(/^\s*resources:\s*\[([^\]]*)\]/gm)]
        .flatMap(match => (match[1] ?? "").split(",").map(item => item.trim().replace(/"/g, "")))
        .filter(item => item.length > 0);
    const webhook = resourcesIn(readFileSync(path.resolve("examples/m2-kubernetes-enforcer/webhook-protected.yaml"), "utf8"));
    const guard = resourcesIn(candidate);
    const audit = resourcesIn(readFileSync(path.resolve("examples/m2-kubernetes-enforcer/m4-audit-policy.yaml"), "utf8"));
    const kinds = webhook.filter(item => !item.includes("/"));
    expect(kinds.sort()).toEqual(["daemonsets", "deployments", "services", "statefulsets"]);
    for (const kind of kinds) {
      expect([kind, guard.includes(`${kind}/status`)]).toEqual([kind, true]);
      expect([kind, audit.includes(`${kind}/status`)]).toEqual([kind, true]);
    }
  });

  it("the harness waits for the policy by name before probing, and verifies its removal before step 3", () => {
    const script = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/kind-repro.sh"), "utf8");
    // The wait loop must match the policy name, not any failure.
    expect(script).toContain('grep -q "changesafe-protected-status-annotations" "${WORK_DIR}/guard-wait.txt"');
    expect(script).toContain('grep -q "changesafe-protected-status-annotations" "${WORK_DIR}/guard-gone.txt"');
    expect(script).toContain("candidate guard removed:");
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

describe("M4-10 the summary script", () => {
  const script = path.resolve("examples/m2-kubernetes-enforcer/m4-status-guard-summary.mjs");
  const deployment = (annotations: Record<string, string>, rv: string, ready = 4) => JSON.stringify({
    metadata: { resourceVersion: rv, annotations }, spec: { replicas: 4 }, status: { readyReplicas: ready, availableReplicas: ready, conditions: [] },
  });

  function run(files: Record<string, string>): unknown {
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-m4-10-"));
    try {
      for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
      execFileSync(process.execPath, [script, dir, path.join(dir, "out.json")], { encoding: "utf8" });
      return JSON.parse(readFileSync(path.join(dir, "out.json"), "utf8"));
    } finally { rmSync(dir, { recursive: true }); }
  }

  it("a missing exit-status file is null, never success", () => {
    const evidence = run({
      "guard-status-annotation.out": "denied", "guard-status-annotation.status": "1\n",
      "guard-status-annotation.after.json": deployment({ "changesafe.dev/grant": "X" }, "10"),
      // the harmless probe's status file is absent on purpose
      "guard-status-harmless.out": "patched",
      "guard-status-harmless.after.json": deployment({ "changesafe.dev/grant": "X" }, "11"),
    });
    const parsed = z.object({
      statusAnnotation: z.object({ exitStatus: z.number().nullable() }),
      statusHarmless: z.object({ exitStatus: z.number().nullable() }),
    }).parse(evidence);
    expect(parsed.statusAnnotation.exitStatus).toBe(1);
    expect(parsed.statusHarmless.exitStatus).toBeNull();
  });

  it("records every annotation of each controller event, so a change to any of them is visible", () => {
    const events = [
      { type: "MODIFIED", object: { kind: "Deployment", metadata: { resourceVersion: "20", annotations: { "changesafe.dev/grant": "X", "other": "a" } }, status: { readyReplicas: 3, availableReplicas: 3 } } },
      { type: "MODIFIED", object: { kind: "Deployment", metadata: { resourceVersion: "21", annotations: { "changesafe.dev/grant": "X", "other": "b" } }, status: { readyReplicas: 4, availableReplicas: 4 } } },
    ].map(event => JSON.stringify(event)).join("\n");
    const evidence = run({ "controller-replay.jsonl": events });
    const parsed = z.object({
      controllerEvents: z.array(z.object({ annotations: z.record(z.string(), z.string()) })),
    }).parse(evidence);
    expect(parsed.controllerEvents.map(event => event.annotations["other"])).toEqual(["a", "b"]);
  });
});

describe("M4-10 the HTTP status parser", () => {
  const script = path.resolve("examples/m2-kubernetes-enforcer/m4-status-guard-summary.mjs");
  function statusOf(out: string): number | null {
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-m4-10-http-"));
    try {
      writeFileSync(path.join(dir, "guard-status-annotation.out"), out);
      writeFileSync(path.join(dir, "guard-status-annotation.status"), "1\n");
      execFileSync(process.execPath, [script, dir, path.join(dir, "out.json")], { encoding: "utf8" });
      const parsed = z.object({ statusAnnotation: z.object({ httpStatus: z.number().nullable() }) })
        .parse(JSON.parse(readFileSync(path.join(dir, "out.json"), "utf8")));
      return parsed.statusAnnotation.httpStatus;
    } finally { rmSync(dir, { recursive: true }); }
  }

  it("reads kubectl's structured response line", () => {
    expect(statusOf('I1011 20:13:24.6 round_trippers.go:632] "Response" verb="PATCH" url="https://x/apis" status="422 Unprocessable Entity" milliseconds=12\n')).toBe(422);
  });
  it("reads the older plain response line", () => {
    expect(statusOf("I1011 20:13:24.6 round_trippers.go:553] PATCH https://x/apis 403 Forbidden in 12 milliseconds\n")).toBe(403);
  });
  it("is null when there is no response line", () => {
    expect(statusOf("Error from server: nothing logged\n")).toBeNull();
  });
});

