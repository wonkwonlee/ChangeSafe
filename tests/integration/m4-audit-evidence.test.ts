import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * M4 experiment 03 (docs/M4_EXPERIMENT_03.md), replayed offline against the
 * audit evidence the live kind run recorded. The fixture is trimmed from a
 * CI artifact whose SHA-256 it names, so this keeps the result checkable
 * after the artifact expires. Nothing here talks to a cluster.
 */

const EvidenceSchema = z.object({
  source: z.object({ ciRun: z.string().url(), artifactSha256: z.string().regex(/^[0-9a-f]{64}$/) }).passthrough(),
  useState: z.array(z.object({ grantId: z.string(), admissionUid: z.string() })),
  events: z.array(z.object({
    auditID: z.string(),
    stage: z.literal("ResponseComplete"),
    requestURI: z.string(),
    code: z.number().int(),
    annotationKeys: z.array(z.string()),
    grantId: z.string(),
    admissionUid: z.string(),
    outcome: z.enum(["allow-consumed", "allow-dry-run", "deny"]),
    stored: z.object({ uid: z.string(), resourceVersion: z.string(), replicas: z.number() }).optional(),
  })),
});
type AuditEvidence = z.infer<typeof EvidenceSchema>["events"][number];

const evidence = EvidenceSchema.parse(JSON.parse(readFileSync(
  path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-audit-events.json"), "utf8")));
const [grant1, grant2] = evidence.useState;
const eventsFor = (grantId: string) => evidence.events.filter(event => event.grantId === grantId);

/** Experiment 02's selection rule, as written there: the first event naming the grant. */
function firstEventForGrant(grantId: string): AuditEvidence | undefined {
  return evidence.events.find(event => event.grantId === grantId);
}

/** The join P2 makes possible: the event whose admission the enforcer recorded as the consumer. */
function consumingEvent(grantId: string): AuditEvidence | undefined {
  const consumer = evidence.useState.find(row => row.grantId === grantId)?.admissionUid;
  return consumer === undefined ? undefined : evidence.events.find(event => event.admissionUid === consumer);
}

describe("M4-03 live evidence: what the audit record carries", () => {
  it("H3a: every annotated event carries the three keys under the webhook's name", () => {
    expect(evidence.events.length).toBe(5);
    for (const event of evidence.events) {
      expect(event.annotationKeys).toEqual([
        "protected.enforcer.changesafe.dev/admission-uid",
        "protected.enforcer.changesafe.dev/grant-id",
        "protected.enforcer.changesafe.dev/outcome",
      ]);
    }
  });

  it("H3b: a write the enforcer allowed and a later stage rejected keeps the enforcer's annotation", () => {
    const rejected = consumingEvent(grant2!.grantId);
    expect(rejected).toMatchObject({ outcome: "allow-consumed", code: 500 });
    expect(rejected?.stored).toBeUndefined();
  });

  it("H3d: the burned grant's retry is refused, and the consumer is the rejected admission", () => {
    expect(eventsFor(grant2!.grantId).map(event => [event.outcome, event.code])).toEqual([
      ["allow-consumed", 500],
      ["deny", 400],
    ]);
  });

  it("H3e: no audit id equals the admission uid it carries", () => {
    for (const event of evidence.events) expect(event.auditID).not.toBe(event.admissionUid);
  });
});

describe("M4-03 live evidence: counterexample to experiment 02's audit rule", () => {
  it("H3c: one grant id names three events, and the first is a dry-run", () => {
    expect(eventsFor(grant1!.grantId).map(event => event.outcome)).toEqual(["allow-dry-run", "allow-consumed", "deny"]);
    expect(firstEventForGrant(grant1!.grantId)?.requestURI).toContain("dryRun=All");
  });

  it("the first-event rule reads a stored state that never existed and contradicts an honest executor", () => {
    const first = firstEventForGrant(grant1!.grantId);
    const actual = consumingEvent(grant1!.grantId);
    // A dry-run 200 response carries a full object: the would-be state at
    // the version it was read from. replicas 4 was never stored at rv 695.
    expect(first).toMatchObject({ code: 200, stored: { resourceVersion: "695", replicas: 4 } });
    expect(actual).toMatchObject({ code: 200, outcome: "allow-consumed", stored: { resourceVersion: "710", replicas: 4 } });
    const honestClaim = actual!.stored!.resourceVersion;
    expect(first!.stored!.resourceVersion).not.toBe(honestClaim);
  });

  it("joining on the admission uid the enforcer recorded picks the persisted write for every consumed grant", () => {
    for (const row of evidence.useState) {
      const event = consumingEvent(row.grantId);
      expect(event?.outcome).toBe("allow-consumed");
      expect(event?.requestURI).not.toContain("dryRun");
    }
    expect(consumingEvent(grant1!.grantId)?.code).toBe(200);
    expect(consumingEvent(grant2!.grantId)?.code).toBe(500);
  });
});
