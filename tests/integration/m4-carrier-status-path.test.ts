import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  completeExact, distinctWorlds, evaluate, histories, isUnsound, observe, protectedOnly, simulate, summarize, v2a, v2b, v2c,
  type AuditEdit, type Coverage, type History, type PriorKnowledge,
} from "./m4-evidence-model";

/**
 * M4 experiment 09 (docs/M4_EXPERIMENT_09.md). First the live probe, from the
 * run's raw artifact checked against its manifest hash. Then what the
 * finding does to experiment 07's contract, in the same model with one
 * history added: a status-subresource write that overwrites the carrier.
 */

const dir = path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-d");
const manifest = z.object({ ciRun: z.string().url(), files: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
const raw = readFileSync(path.join(dir, "m4-carrier-probe-evidence.json"));
if (createHash("sha256").update(raw).digest("hex") !== manifest.files["m4-carrier-probe-evidence.json"]) {
  throw new Error("the probe artifact does not match its manifest hash");
}
const State = z.object({
  resourceVersion: z.string().nullable(),
  carrier: z.string().nullable(),
  replicas: z.number().nullable(),
  probeLabel: z.string().nullable(),
});
const Evidence = z.object({
  before: State,
  probes: z.array(z.object({ name: z.string(), exitStatus: z.number().nullable(), output: z.string(), after: State })),
  audit: z.array(z.object({
    verb: z.string(), subresource: z.string().nullable(), code: z.number().nullable(),
    // The committed artifact predates the rename to enforcerGrantAnnotated.
    enforcerAnnotated: z.boolean().optional(), enforcerGrantAnnotated: z.boolean().optional(),
    touchesForgedCarrier: z.boolean(),
  })),
});
const evidence = Evidence.parse(JSON.parse(raw.toString("utf8")));
const probe = (name: string) => {
  const found = evidence.probes.find(item => item.name === name);
  if (found === undefined) throw new Error(`the artifact has no ${name} probe`);
  return found;
};

describe("M4-09 live evidence: what the API server did", () => {
  it("H9b: the same annotation through the main resource is denied by the enforcer", () => {
    const main = probe("annotate-main");
    expect(main.exitStatus).not.toBe(0);
    expect(main.output).toContain("protected.enforcer.changesafe.dev");
    expect(main.output).toContain("denied the request");
    expect(main.after.resourceVersion).toBe(evidence.before.resourceVersion);
    expect(main.after.carrier).toBe(evidence.before.carrier);
  });

  it("H9a: a patch to the status subresource sets the carrier, and it persists, replacing the real one", () => {
    const status = probe("patch-status-annotation");
    expect(status.exitStatus).toBe(0);
    expect(status.after.carrier).toBe("m4-forged-status");
    expect(evidence.before.carrier).not.toBe("m4-forged-status");
    expect(evidence.before.carrier?.length).toBeGreaterThan(100); // a real, encoded grant
    expect(status.after.resourceVersion).not.toBe(evidence.before.resourceVersion);
    // Any string was accepted: the carrier's format is not validated by the API server.
    expect(status.output).toContain("patched");
  });

  it("H9c: a status write that also tries to change spec and labels changes neither", () => {
    const spec = probe("patch-status-spec");
    expect(spec.exitStatus).toBe(0);
    expect(spec.output).toContain("no change");
    expect(spec.after.replicas).toBe(evidence.before.replicas);
    expect(spec.after.probeLabel).toBeNull();
    expect(spec.after.resourceVersion).toBe(probe("patch-status-annotation").after.resourceVersion);
  });

  it("H9d: the status writes are in the audit log, succeeded, and carry no enforcer annotation", () => {
    // The probe's own requests are the `patch` verbs; the Deployment
    // controller's status updates in the same artifact are `update`.
    const patches = evidence.audit.filter(event => event.verb === "patch");
    expect(patches).toHaveLength(3);
    const status = patches.filter(event => event.subresource === "status");
    expect(status).toHaveLength(2);
    for (const event of status) {
      expect(event.code).toBe(200);
      expect(event.enforcerAnnotated ?? event.enforcerGrantAnnotated).toBe(false);
    }
    expect(status.filter(event => event.touchesForgedCarrier)).toHaveLength(1);
    // The denied main-resource request, for contrast.
    const main = patches.filter(event => event.subresource === null);
    expect(main).toHaveLength(1);
    expect(main[0]?.code).toBe(400);
    // What is observed is "no annotation". That the webhook was not called
    // is the inference from success with no grant attached: the same
    // request on the main resource was denied for exactly that.
  });

  it("the audit evidence also lists the controller's own status updates, which a probe's filter must exclude", () => {
    const updates = evidence.audit.filter(event => event.verb === "update" && event.subresource === "status");
    // 18 of them: 15 succeeded and 3 lost an optimistic-concurrency race (409).
    expect(updates).toHaveLength(18);
    expect(updates.filter(event => event.code === 200)).toHaveLength(15);
    expect(updates.filter(event => event.code === 409)).toHaveLength(3);
    expect(updates.every(event => !event.touchesForgedCarrier)).toBe(true);
  });
});

describe("M4-09 what the finding does to experiment 07's contract", () => {
  const options = { withStatusPath: true } as const;
  const scopeA = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && protectedOnly(h);
  const assume = () => true;

  it("counts are of evaluations; the histories are fewer distinct worlds, and none is dead", () => {
    // Review finding: an earlier draft had a history that never fired (an
    // annotation overwrite with no state to overwrite), duplicating "none".
    const all = [...histories(options)];
    expect(all).toHaveLength(1024);
    expect(distinctWorlds(all)).toBe(396);
    const protectedHistories = all.filter(history => history.tier === "protected");
    expect(protectedHistories).toHaveLength(416);
    expect(distinctWorlds(protectedHistories)).toBe(264);
    // Every status-path history changes the world relative to the same
    // history with the status write removed.
    for (const history of all.filter(h => h.later === "via_other_grant_then_status_overwrite" || h.later === "status_erases_carrier")) {
      const without = { ...history, later: history.later === "status_erases_carrier" ? ("none" as const) : ("via_other_grant" as const) };
      if (history.later === "via_other_grant_then_status_overwrite" && history.noOp) continue;
      expect(JSON.stringify(simulate(history).events)).not.toBe(JSON.stringify(simulate(without).events));
    }
  });

  it("the new histories are real worlds: the carrier is re-attributed to a rejected grant on a state another grant stored", () => {
    const forged = [...histories(options)].filter(h => h.later === "via_other_grant_then_status_overwrite" && h.attempt === "rejected_downstream" && !h.noOp && !h.recreated);
    expect(forged.length).toBeGreaterThan(0);
    const world = simulate(forged[0] as History);
    const last = world.events[world.events.length - 1];
    expect(last).toMatchObject({ state: "T", carrier: "G" });
    expect(world.events[world.events.length - 2]).toMatchObject({ state: "T", carrier: "G3" });
  });

  it("v2a and v2b, sound in experiment 07's protected tier, are unsound once the status path exists", () => {
    const a = summarize(evaluate(v2a, scopeA, assume, options));
    const b = summarize(evaluate(v2b, scopeA, assume, options));
    expect(b.total).toBe(2496);
    expect(b.unsound).toHaveLength(192);
    expect(a.unsound).toHaveLength(96);
    for (const row of [...a.unsound, ...b.unsound]) {
      expect(row.history.later).toBe("via_other_grant_then_status_overwrite");
      expect(row.truth).toBe("rejected");
      expect(row.verdict).toBe("stored");
    }
    // How useful each remains: definite verdicts, which is what v2c gives up.
    expect(a.definite).toBe(1536);
    expect(b.definite).toBe(2496);
    // Over the whole protected grid, every coverage, prior and audit edit.
    const gridB = summarize(evaluate(v2b, protectedOnly, assume, options));
    const gridA = summarize(evaluate(v2a, protectedOnly, assume, options));
    expect(gridB.unsound).toHaveLength(1536);
    expect(gridA.unsound).toHaveLength(768);
    expect(gridB.definite).toBe(21924);
    expect(gridA.definite).toBe(16308);
    expect(summarize(evaluate(v2c, protectedOnly, assume, options)).definite).toBe(16356);
  });

  it("v2c, which needs the carrier and the state transition in one event, has no unsound verdict on the grid", () => {
    // Post hoc: written after the probe, and checked against the enumeration
    // it was designed against. It is a proposal, not a result in its own right.
    const rows = evaluate(v2c, protectedOnly, assume, options);
    expect(rows).toHaveLength(37440);
    expect(rows.filter(isUnsound)).toEqual([]);
    const scope = summarize(evaluate(v2c, scopeA, assume, options));
    expect(scope.unsound).toEqual([]);
    expect(scope.definite).toBe(1824);
  });

  it("a status write that erases the carrier of a stored grant loses nothing: the earlier event is still in the history", () => {
    // The probe's finding 1. A contract that reads the history is not
    // affected; one that read only the object's current carrier would be.
    const erased = [...histories(options)].filter(h => h.later === "status_erases_carrier" && h.attempt === "stored" && !h.noOp && !h.recreated && h.tier === "protected");
    expect(erased.length).toBeGreaterThan(0);
    for (const history of erased) {
      const world = simulate(history);
      expect(world.events[world.events.length - 1]).toMatchObject({ carrier: "X" });
      expect(v2c(observe(history, "none", "complete", "exact", true))).toBe("stored");
      expect(v2b(observe(history, "none", "complete", "exact", true))).toBe("stored");
    }
  });

  it("v2c's own precondition is load-bearing: where a write outside the enforcer can change the spec and set the carrier together, it is unsound too", () => {
    // The default tier has exactly that history (sets_target_copied_carrier).
    // The status path cannot do it (H9c); a path that could would break v2c.
    const scope = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && h.tier === "default";
    const result = summarize(evaluate(v2c, scope, assume, options));
    expect(result.unsound).toHaveLength(96);
    expect(result.unsound.every(row => row.history.later === "sets_target_copied_carrier")).toBe(true);
  });

  it("not assuming the carrier is the reading of the tier as deployed; the contracts are sound and say less", () => {
    // v2c's own precondition is weaker than "unforgeable": that no writer
    // outside the enforcer can change the spec and set the annotation in one
    // write. The status path cannot; the main resource is the enforcer's.
    for (const contract of [v2a, v2b, v2c]) {
      const rows = evaluate(contract, protectedOnly, () => false, options);
      expect(summarize(rows).unsound).toEqual([]);
      expect(rows.some(row => row.verdict === "stored")).toBe(false);
    }
  });

  it("v2c does not carry a state across a deletion", () => {
    // A re-created object's first event has no predecessor in its own
    // lifetime, so a carrier on it is not read as a transition.
    const base = { uid: "U1" as const, type: "MODIFIED" as const };
    const obs = {
      consumed: true, auditClaim: "absent" as const, coverage: "complete" as const, streamStart: 100, closedAt: 104,
      endedCleanly: true, priorRv: 100, grantIsNoOp: false, assumeCarrierUnforgeable: true,
      events: [
        { ...base, rv: 101, state: "P" as const, carrier: null },
        { ...base, rv: 102, state: "P" as const, carrier: null, type: "DELETED" as const },
        { ...base, rv: 103, state: "T" as const, carrier: "G" as const, uid: "U2" as const, type: "ADDED" as const },
        { ...base, rv: 104, state: "T" as const, carrier: "G" as const, uid: "U2" as const },
      ],
    };
    expect(v2c(obs)).toBe("unknown");
    expect(v2b(obs)).toBe("stored");
  });

  it("v2c pays for it: no-op targets and carrier-only events are unknown for presence", () => {
    const b = summarize(evaluate(v2b, scopeA, assume, options));
    const c = summarize(evaluate(v2c, scopeA, assume, options));
    expect(c.definite).toBeLessThan(b.definite);
    // Every no-op grant that was stored comes back unknown under v2c.
    const storedNoOp = evaluate(v2c, scopeA, assume, options).filter(row => row.history.noOp && row.truth === "stored");
    expect(storedNoOp.length).toBeGreaterThan(0);
    expect(storedNoOp.every(row => row.verdict === "unknown")).toBe(true);
  });

  it("a forged carrier on a no-op target cannot be told from a genuine one, by any of these contracts", () => {
    // The transition rule has nothing to see when the spec does not change.
    const obs = observe(
      { attempt: "rejected_downstream", noOp: true, statusBefore: false, statusAfter: false, otherGrantBefore: false,
        later: "via_other_grant_then_status_overwrite", recreated: false, tier: "protected" },
      "none", "complete", "exact", true);
    expect(v2c(obs)).not.toBe("rejected");
    expect(v2b(obs)).toBe("stored");
  });
});

describe("M4-09 the probe summary script", () => {
  const script = path.resolve("examples/m2-kubernetes-enforcer/m4-carrier-probe-summary.mjs");
  const deployment = (carrier: string | null, rv: string, replicas = 4) => JSON.stringify({
    metadata: { resourceVersion: rv, ...(carrier === null ? {} : { annotations: { "changesafe.dev/grant": carrier } }) },
    spec: { replicas },
  });
  const auditLine = (fields: Record<string, unknown>) => JSON.stringify({
    verb: "update",
    objectRef: { resource: "deployments", name: "web", namespace: "changesafe-protected-demo", subresource: "status" },
    user: { username: "kubernetes-admin" },
    requestReceivedTimestamp: "2026-10-11T12:00:05.000000Z",
    responseStatus: { code: 200 },
    ...fields,
  });

  function run(files: Record<string, string>, audit: string): { evidence: unknown; stdout: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-m4-09-"));
    try {
      for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
      writeFileSync(path.join(dir, "audit.log"), audit);
      const stdout = execFileSync(process.execPath, [script, dir, path.join(dir, "audit.log"), path.join(dir, "out.json")], { encoding: "utf8" });
      return { evidence: JSON.parse(readFileSync(path.join(dir, "out.json"), "utf8")), stdout };
    } finally { rmSync(dir, { recursive: true }); }
  }

  const probeFiles = {
    "probe-before.json": deployment("REAL", "10"),
    "probe-window.txt": "2026-10-11T12:00:00.000000Z\n2026-10-11T12:00:10.000000Z\n",
    "probe-annotate-main.out": "denied", "probe-annotate-main.status": "1\n", "probe-annotate-main.after.json": deployment("REAL", "10"),
    "probe-patch-status-annotation.out": "patched", "probe-patch-status-annotation.status": "0\n",
    "probe-patch-status-annotation.after.json": deployment("m4-forged-status", "11"),
    // the third probe's files are absent on purpose
  };

  it("a missing exit-status file is null, never success", () => {
    const { evidence } = run(probeFiles, "");
    const probes = z.object({ probes: z.array(z.object({ name: z.string(), exitStatus: z.number().nullable() })) }).parse(evidence).probes;
    expect(probes.find(p => p.name === "patch-status-annotation")?.exitStatus).toBe(0);
    expect(probes.find(p => p.name === "annotate-main")?.exitStatus).toBe(1);
    expect(probes.find(p => p.name === "patch-status-spec")?.exitStatus).toBeNull();
  });

  it("keeps the probe's own requests and drops the controller's, other namespaces, and events outside the window", () => {
    const audit = [
      auditLine({ verb: "patch", requestObject: { metadata: { annotations: { "changesafe.dev/grant": "m4-forged-status" } } } }),
      auditLine({ user: { username: "system:serviceaccount:kube-system:deployment-controller" } }),
      auditLine({ objectRef: { resource: "deployments", name: "web", namespace: "changesafe-default-demo", subresource: "status" } }),
      auditLine({ verb: "patch", requestReceivedTimestamp: "2026-10-11T11:59:00.000000Z" }),
      auditLine({ verb: "patch", requestReceivedTimestamp: "2026-10-11T12:30:00.000000Z" }),
    ].join("\n");
    const { evidence } = run(probeFiles, audit);
    const kept = z.object({ audit: z.array(z.object({ verb: z.string(), user: z.string(), touchesForgedCarrier: z.boolean() })) }).parse(evidence).audit;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ verb: "patch", user: "kubernetes-admin", touchesForgedCarrier: true });
  });

  it("does not claim a call from the absence of annotations: the field is the grant annotation, and a webhook denial is its own field", () => {
    const audit = auditLine({
      verb: "patch", objectRef: { resource: "deployments", name: "web", namespace: "changesafe-protected-demo" },
      requestObject: { metadata: { annotations: { "changesafe.dev/grant": "m4-forged-main" } } },
      responseStatus: { code: 400, message: 'admission webhook "protected.enforcer.changesafe.dev" denied the request: no AuthorizationGrant was attached to this request' },
    });
    const { evidence } = run(probeFiles, audit);
    const kept = z.object({ audit: z.array(z.object({ enforcerGrantAnnotated: z.boolean(), deniedByWebhook: z.boolean() })) }).parse(evidence).audit;
    expect(kept).toEqual([{ enforcerGrantAnnotated: false, deniedByWebhook: true }]);
  });
});

