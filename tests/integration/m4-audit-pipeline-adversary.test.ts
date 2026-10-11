import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { kubernetesObjectSha256 } from "@changesafe/kubernetes-enforcer";
import { compareResourceVersions } from "./resource-version";

/**
 * M4 experiment 04 (docs/M4_EXPERIMENT_04.md): what can a party who controls
 * the audit pipeline make an E2 observation say? Every attack starts from the
 * real evidence of experiment 03's live run and changes only what the attack
 * model lets the adversary change: audit events. The signed grant, the
 * enforcer's use-state, and an independent read are outside their reach.
 * Both contracts below are test-local, per docs/M4_DECISION.md.
 */

const evidenceDir = path.resolve("examples/m2-kubernetes-enforcer/evidence");
const KubernetesObjectSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({ uid: z.string(), resourceVersion: z.string() }).passthrough(),
  spec: z.record(z.string(), z.unknown()),
}).passthrough();
type KubernetesObject = z.infer<typeof KubernetesObjectSchema>;

const live03 = z.object({
  useState: z.array(z.object({ grantId: z.string(), admissionUid: z.string() })),
  events: z.array(z.object({
    auditID: z.string(), requestURI: z.string(), code: z.number().int(),
    grantId: z.string(), admissionUid: z.string(), outcome: z.string(),
  }).passthrough()),
}).parse(JSON.parse(readFileSync(path.join(evidenceDir, "2026-10-11-m4-audit-events.json"), "utf8")));
const stored03 = z.object({
  grant: z.object({ grantId: z.string(), resourceUid: z.string(), objectSha256: z.string() }),
  priorResourceVersion: z.string(),
  stored: KubernetesObjectSchema,
}).parse(JSON.parse(readFileSync(path.join(evidenceDir, "2026-10-11-m4-stored-object.json"), "utf8")));

/** What ChangeSafe holds without the pipeline: the grant, the enforcer's consumer record, the prior version. */
interface Held {
  grant: { grantId: string; resourceUid: string; objectSha256: string };
  consumerAdmissionUid?: string;
  /** `oldObject.metadata.resourceVersion` at admission — not recorded by the enforcer today. */
  priorResourceVersion?: string;
}

interface AuditEvent {
  auditID: string;
  admissionUid: string;
  grantId: string;
  outcome: string;
  code: number;
  isDryRun: boolean;
  stored?: KubernetesObject;
}

type Read = { kind: "unavailable" } | { kind: "present"; object: KubernetesObject };

type AuditVerdict =
  | "unknown_not_consumed"
  | "unknown_no_event"
  | "unknown_conflicting_events"
  | "audit_inconsistent_with_grant"
  | "audit_reports_rejected"
  | "audit_reports_stored";
type CheckedVerdict = AuditVerdict | "contradicted_by_read";

/** 03's join, made strict: one event for the consuming admission, consistent with the grant. */
async function auditOnly(held: Held, events: AuditEvent[]): Promise<AuditVerdict> {
  if (held.consumerAdmissionUid === undefined) return "unknown_not_consumed";
  const matches = events.filter(event => event.admissionUid === held.consumerAdmissionUid);
  const [event] = matches;
  if (event === undefined) return "unknown_no_event";
  if (matches.length > 1) return "unknown_conflicting_events";
  if (event.grantId !== held.grant.grantId || event.outcome !== "allow-consumed" || event.isDryRun) {
    return "audit_inconsistent_with_grant";
  }
  if (event.code >= 400) return "audit_reports_rejected";
  if (event.stored !== undefined) {
    const matchesGrant =
      event.stored.metadata.uid === held.grant.resourceUid &&
      (await kubernetesObjectSha256(event.stored)) === held.grant.objectSha256;
    if (!matchesGrant) return "audit_inconsistent_with_grant";
  }
  return "audit_reports_stored";
}

/** The same, cross-checked against a read the pipeline cannot touch. */
async function auditPlusRead(held: Held, events: AuditEvent[], read: Read): Promise<CheckedVerdict> {
  const verdict = await auditOnly(held, events);
  if (verdict !== "audit_reports_stored" || read.kind === "unavailable") return verdict;
  if (read.object.metadata.uid !== held.grant.resourceUid) return verdict;
  const current = read.object.metadata.resourceVersion;
  // Same incarnation still at the version the enforcer saw: nothing was stored since.
  if (held.priorResourceVersion !== undefined && compareResourceVersions(current, held.priorResourceVersion) === 0) {
    return "contradicted_by_read";
  }
  // A "stored" version newer than what is stored now cannot be a past write.
  const event = events.find(candidate => candidate.admissionUid === held.consumerAdmissionUid);
  const claimed = event?.stored?.metadata.resourceVersion;
  if (claimed !== undefined && compareResourceVersions(claimed, current) === 1) return "contradicted_by_read";
  return verdict;
}

// --- Baseline: experiment 03's real evidence -------------------------------

const realEvents: AuditEvent[] = live03.events.map(event => ({
  auditID: event.auditID,
  admissionUid: event.admissionUid,
  grantId: event.grantId,
  outcome: event.outcome,
  code: event.code,
  isDryRun: /[?&]dryRun=/.test(event.requestURI),
  // Only the persisted write's stored object is in the fixture; the dry-run's
  // is irrelevant to the consuming-event join and is left out.
  ...(event.auditID.startsWith("05ff2e2a") ? { stored: stored03.stored } : {}),
}));
const [use1, use2] = live03.useState;
const grant1: Held = {
  grant: stored03.grant,
  consumerAdmissionUid: use1!.admissionUid,
  priorResourceVersion: stored03.priorResourceVersion,
};
// Grant 2 was admitted against the object grant 1 stored (rv 710). Its own
// objectSha256 is not in the fixture; nothing below checks a stored object for it.
const grant2: Held = {
  grant: { grantId: use2!.grantId, resourceUid: stored03.grant.resourceUid, objectSha256: "not-in-fixture" },
  consumerAdmissionUid: use2!.admissionUid,
  priorResourceVersion: stored03.stored.metadata.resourceVersion,
};
const withVersion = (object: KubernetesObject, resourceVersion: string, replicas: number): KubernetesObject => ({
  ...object,
  metadata: { ...object.metadata, resourceVersion },
  spec: { ...object.spec, replicas },
});
/** Modeled read after 03's run: grant 2 was rejected and nothing else wrote, so rv 710 stands. */
const readAfterRun: Read = { kind: "present", object: stored03.stored };
const consumingEventOf = (held: Held) => realEvents.find(event => event.admissionUid === held.consumerAdmissionUid)!;
const replace = (events: AuditEvent[], target: AuditEvent, next: AuditEvent | undefined) =>
  events.flatMap(event => (event === target ? (next === undefined ? [] : [next]) : [event]));

describe("M4-04 baseline: the unaltered 03 evidence", () => {
  it("the real stored object matches its grant, and both contracts agree with what happened", async () => {
    expect(await kubernetesObjectSha256(stored03.stored)).toBe(stored03.grant.objectSha256);
    expect(await auditOnly(grant1, realEvents)).toBe("audit_reports_stored");
    expect(await auditPlusRead(grant1, realEvents, readAfterRun)).toBe("audit_reports_stored");
    expect(await auditOnly(grant2, realEvents)).toBe("audit_reports_rejected");
    expect(await auditPlusRead(grant2, realEvents, readAfterRun)).toBe("audit_reports_rejected");
  });
});

describe("M4-04 attacks the contract absorbs", () => {
  it("H4a: dropping the consuming event yields unknown, for a stored and a rejected write", async () => {
    expect(await auditOnly(grant1, replace(realEvents, consumingEventOf(grant1), undefined))).toBe("unknown_no_event");
    expect(await auditOnly(grant2, replace(realEvents, consumingEventOf(grant2), undefined))).toBe("unknown_no_event");
  });

  it("H4b: injecting a second event for the consumed admission yields unknown", async () => {
    const injected = { ...consumingEventOf(grant2), auditID: "forged-0001", code: 200 };
    expect(await auditOnly(grant2, [...realEvents, injected])).toBe("unknown_conflicting_events");
  });

  it("an altered stored object that no longer matches the grant is caught by the grant itself", async () => {
    const altered = { ...consumingEventOf(grant1), stored: withVersion(stored03.stored, "710", 9) };
    expect(await auditOnly(grant1, replace(realEvents, consumingEventOf(grant1), altered))).toBe("audit_inconsistent_with_grant");
  });
});

describe("M4-04 attacks that change the verdict", () => {
  it("H4c: flipping a rejected write's 500 to 200 fools the audit evidence; the read contradicts it", async () => {
    const flipped = { ...consumingEventOf(grant2), code: 200 };
    const events = replace(realEvents, consumingEventOf(grant2), flipped);
    expect(await auditOnly(grant2, events)).toBe("audit_reports_stored");
    expect(await auditPlusRead(grant2, events, readAfterRun)).toBe("contradicted_by_read");
  });

  it("H4d: a fabricated 200 whose stored object matches the grant passes every audit check", async () => {
    // Model: grant 1's real write had instead been rejected, with nothing
    // stored since (the read still shows rv 695, replicas 3). The forger
    // copies the target state from the grant-bearing request it can read,
    // which is exactly the object the grant hashes — here, the real one.
    const fabricated = { ...consumingEventOf(grant1), stored: withVersion(stored03.stored, "701", 4) };
    const events = replace(realEvents, consumingEventOf(grant1), fabricated);
    expect(await kubernetesObjectSha256(fabricated.stored)).toBe(grant1.grant.objectSha256);
    expect(await auditOnly(grant1, events)).toBe("audit_reports_stored");
    const nothingSince: Read = { kind: "present", object: withVersion(stored03.stored, "695", 3) };
    expect(await auditPlusRead(grant1, events, nothingSince)).toBe("contradicted_by_read");
  });

  it("H4e: once a later write lands, the read catches only a 'stored' version from the future", async () => {
    // Same model, but another writer stored the resource after the
    // rejection (rv 900). A forger claiming rv 760 — between admission and
    // now — cannot be contradicted; one claiming rv 950 can.
    const laterWrite: Read = { kind: "present", object: withVersion(stored03.stored, "900", 3) };
    const plausible = { ...consumingEventOf(grant1), stored: withVersion(stored03.stored, "760", 4) };
    const future = { ...consumingEventOf(grant1), stored: withVersion(stored03.stored, "950", 4) };
    expect(await auditPlusRead(grant1, replace(realEvents, consumingEventOf(grant1), plausible), laterWrite)).toBe("audit_reports_stored");
    expect(await auditPlusRead(grant1, replace(realEvents, consumingEventOf(grant1), future), laterWrite)).toBe("contradicted_by_read");
  });

  it("H4c without a recorded prior version: the read cannot contradict the flip", async () => {
    // The enforcer does not record oldObject.resourceVersion today. Without
    // it, "nothing stored since" is not decidable, and the flip stands.
    const flipped = { ...consumingEventOf(grant2), code: 200 };
    const { priorResourceVersion: _omitted, ...withoutPrior } = grant2;
    expect(await auditPlusRead(withoutPrior, replace(realEvents, consumingEventOf(grant2), flipped), readAfterRun)).toBe("audit_reports_stored");
  });

  it("the reverse attack: hiding a stored write behind a 500 is never contradicted", async () => {
    // Not pre-registered. Rewriting grant 1's real 200 as a 500 and dropping
    // its stored object makes a persisted write read as rejected. The read
    // shows a version newer than admission, which a rejected write followed
    // by any other write would also show, and auditPlusRead cross-checks
    // only "stored" verdicts.
    const hidden: AuditEvent = { ...consumingEventOf(grant1), code: 500 };
    delete hidden.stored;
    const events = replace(realEvents, consumingEventOf(grant1), hidden);
    expect(await auditOnly(grant1, events)).toBe("audit_reports_rejected");
    expect(await auditPlusRead(grant1, events, readAfterRun)).toBe("audit_reports_rejected");
  });
});

describe("M4-04 vocabulary", () => {
  it("every verdict names its source; none reads as an attestation", () => {
    const verdicts: CheckedVerdict[] = [
      "unknown_not_consumed", "unknown_no_event", "unknown_conflicting_events",
      "audit_inconsistent_with_grant", "audit_reports_rejected", "audit_reports_stored", "contradicted_by_read",
    ];
    for (const verdict of verdicts) {
      expect(verdict).toMatch(/^(unknown_|audit_|contradicted_)/);
      expect(verdict).not.toMatch(/persist|verified|proven|success|realized/);
    }
  });
});
