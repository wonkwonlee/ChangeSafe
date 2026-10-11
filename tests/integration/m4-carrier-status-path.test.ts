import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  completeExact, evaluate, histories, isUnsound, observe, protectedOnly, simulate, summarize, v2a, v2b, v2c,
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
  probes: z.array(z.object({ name: z.string(), exitStatus: z.number(), output: z.string(), after: State })),
  audit: z.array(z.object({
    verb: z.string(), subresource: z.string().nullable(), code: z.number().nullable(), enforcerAnnotated: z.boolean(),
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

  it("H9d (not decided): the run's audit policy did not cover deployments/status, so its status writes are not in the audit evidence", () => {
    // The only audit event in the artifact for the probes is the denied
    // main-resource request. That the webhook was not called for the status
    // writes is inferred from their success with no grant attached (the
    // webhook denies that, as the main-resource probe shows), not observed.
    expect(evidence.audit.filter(event => event.subresource === "status")).toEqual([]);
    expect(evidence.audit.filter(event => event.code === 400)).toHaveLength(1);
  });
});

describe("M4-09 what the finding does to experiment 07's contract", () => {
  const options = { withStatusPath: true } as const;
  const scopeA = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && protectedOnly(h);
  const assume = () => true;

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
    expect(b.total).toBe(2880);
    expect(b.unsound).toHaveLength(192);
    expect(a.unsound).toHaveLength(96);
    for (const row of [...a.unsound, ...b.unsound]) {
      expect(row.history.later).toBe("via_other_grant_then_status_overwrite");
      expect(row.truth).toBe("rejected");
      expect(row.verdict).toBe("stored");
    }
    // Over the whole protected grid, every coverage, prior and audit edit.
    expect(summarize(evaluate(v2b, protectedOnly, assume, options)).unsound).toHaveLength(1536);
    expect(summarize(evaluate(v2a, protectedOnly, assume, options)).unsound).toHaveLength(768);
  });

  it("v2c, which needs the carrier and the state transition in one event, has no unsound verdict on the grid", () => {
    // Post hoc: written after the probe, and checked against the enumeration
    // it was designed against. It is a proposal, not a result in its own right.
    const rows = evaluate(v2c, protectedOnly, assume, options);
    expect(rows).toHaveLength(43200);
    expect(rows.filter(isUnsound)).toEqual([]);
    expect(summarize(evaluate(v2c, scopeA, assume, options)).unsound).toEqual([]);
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
