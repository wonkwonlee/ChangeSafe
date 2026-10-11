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
    auditID: z.string(), verb: z.string(), requestURI: z.string(), code: z.number().int(),
    grantId: z.string(), admissionUid: z.string(), outcome: z.string(),
  }).passthrough()),
}).parse(JSON.parse(readFileSync(path.join(evidenceDir, "2026-10-11-m4-audit-events.json"), "utf8")));
const stored03 = z.object({
  source: z.object({ auditID: z.string() }).passthrough(),
  grant: z.object({ grantId: z.string(), resourceUid: z.string(), objectSha256: z.string() }),
  priorResourceVersion: z.string(),
  stored: KubernetesObjectSchema,
}).parse(JSON.parse(readFileSync(path.join(evidenceDir, "2026-10-11-m4-stored-object.json"), "utf8")));

/** What ChangeSafe holds without the pipeline: the grant, the enforcer's consumer record, the prior version. */
interface Held {
  grant: { grantId: string; resourceUid: string; objectSha256?: string };
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
  verb: string;
  requestURI: string;
  stored?: KubernetesObject;
}

type Read = { kind: "unavailable" } | { kind: "present"; object: KubernetesObject };

const AUDIT_VERDICTS = [
  "unknown_not_consumed",
  "unknown_no_event",
  "unknown_conflicting_events",
  "unknown_unrecognized_event",
  "audit_inconsistent_with_grant",
  "audit_reports_rejected",
  "audit_reports_stored",
] as const;
type AuditVerdict = (typeof AUDIT_VERDICTS)[number];
const READ_VERDICTS = ["contradicted_by_read"] as const;
type CheckedVerdict = AuditVerdict | (typeof READ_VERDICTS)[number];

/** Every verdict either contract actually returned, so the vocabulary test reads real outputs. */
const returned = new Set<CheckedVerdict>();
function done<V extends CheckedVerdict>(verdict: V): V {
  returned.add(verdict);
  return verdict;
}

const WRITE_VERBS = new Set(["create", "update", "patch"]);

/** True when the request URI carries a dryRun parameter, under any spelling case. */
function isDryRun(requestURI: string): boolean {
  const query = requestURI.includes("?") ? requestURI.slice(requestURI.indexOf("?") + 1) : "";
  return [...new URLSearchParams(query).keys()].some(key => key.toLowerCase() === "dryrun");
}

/**
 * The event for the consuming admission, or why there is not exactly one.
 * Redelivery is normal for an at-least-once sink: copies identical in every
 * field collapse to one event. Two different events under one admission uid,
 * or under one audit id, are a conflict, never a choice.
 */
function consumingEvent(held: Held, events: AuditEvent[]): AuditEvent | "none" | "conflict" {
  const matches = events.filter(event => event.admissionUid === held.consumerAdmissionUid);
  const distinct = new Map<string, AuditEvent>();
  for (const event of matches) distinct.set(JSON.stringify(event), event);
  if (distinct.size === 0) return "none";
  const ids = new Set([...distinct.values()].map(event => event.auditID));
  if (distinct.size > 1 || ids.size > 1) return "conflict";
  return [...distinct.values()][0] ?? "none";
}

/** 03's join, made strict: one event for the consuming admission, consistent with the grant. */
async function auditOnly(held: Held, events: AuditEvent[]): Promise<AuditVerdict> {
  if (held.consumerAdmissionUid === undefined) return done("unknown_not_consumed");
  const event = consumingEvent(held, events);
  if (event === "none") return done("unknown_no_event");
  if (event === "conflict") return done("unknown_conflicting_events");
  if (event.grantId !== held.grant.grantId || event.outcome !== "allow-consumed" || isDryRun(event.requestURI)) {
    return done("audit_inconsistent_with_grant");
  }
  if (!WRITE_VERBS.has(event.verb)) return done("unknown_unrecognized_event");
  if (event.code >= 400 && event.code < 600) return done("audit_reports_rejected");
  if (event.code < 200 || event.code >= 300) return done("unknown_unrecognized_event");
  if (event.stored !== undefined) {
    const matchesGrant =
      event.stored.metadata.uid === held.grant.resourceUid &&
      held.grant.objectSha256 !== undefined &&
      (await kubernetesObjectSha256(event.stored)) === held.grant.objectSha256;
    if (!matchesGrant) return done("audit_inconsistent_with_grant");
  }
  return done("audit_reports_stored");
}

/** The grant id a stored object's carrier annotation names, if it parses. */
function carrierGrantId(object: KubernetesObject): string | undefined {
  const raw = (object.metadata as { annotations?: Record<string, string> }).annotations?.["changesafe.dev/grant"];
  if (typeof raw !== "string") return undefined;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(text);
    return z.object({ grant: z.object({ grantId: z.string() }) }).parse(parsed).grant.grantId;
  } catch {
    return undefined;
  }
}

interface ReadOptions {
  /**
   * Whether a writer outside the enforcer's webhook can set the carrier
   * annotation: true for a tier that fails open (a write with no grant is
   * admitted), false only where every write must carry its own consumed
   * grant. Experiment 01 showed the annotation is client-writable; this
   * flag is what the tier adds. Unknown is treated as true.
   */
  carrierWritableOutsideEnforcer: boolean;
}

/** The same, cross-checked against a read the pipeline cannot touch. */
async function auditPlusRead(
  held: Held,
  events: AuditEvent[],
  read: Read,
  options: ReadOptions = { carrierWritableOutsideEnforcer: true },
): Promise<CheckedVerdict> {
  const verdict = await auditOnly(held, events);
  if (read.kind === "unavailable") return verdict;
  if (read.object.metadata.uid !== held.grant.resourceUid) return verdict;
  const current = read.object.metadata.resourceVersion;

  if (verdict === "audit_reports_rejected") {
    // A read that already holds the grant's exact target state and carries
    // this grant's id contradicts "rejected" — but only where nothing but
    // the consuming admission could have set that carrier.
    const holdsTarget =
      held.grant.objectSha256 !== undefined &&
      (await kubernetesObjectSha256(read.object)) === held.grant.objectSha256;
    if (holdsTarget && carrierGrantId(read.object) === held.grant.grantId && !options.carrierWritableOutsideEnforcer) {
      return done("contradicted_by_read");
    }
    return verdict;
  }
  if (verdict !== "audit_reports_stored") return verdict;

  // Same incarnation still at the version the enforcer saw: nothing was stored since.
  if (held.priorResourceVersion !== undefined && compareResourceVersions(current, held.priorResourceVersion) === 0) {
    return done("contradicted_by_read");
  }
  // A "stored" version newer than what is stored now cannot be a past write.
  const event = consumingEvent(held, events);
  const claimed = event === "none" || event === "conflict" ? undefined : event.stored?.metadata.resourceVersion;
  if (claimed !== undefined && compareResourceVersions(claimed, current) === 1) return done("contradicted_by_read");
  return verdict;
}

// --- Baseline: experiment 03's real evidence -------------------------------

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`fixture is missing ${what}`);
  return value;
};

const realEvents: AuditEvent[] = live03.events.map(event => ({
  auditID: event.auditID,
  admissionUid: event.admissionUid,
  grantId: event.grantId,
  outcome: event.outcome,
  code: event.code,
  verb: event.verb,
  requestURI: event.requestURI,
  // Only the persisted write's stored object is in the fixture, tied to its
  // audit event by the audit id the fixture records; the dry-run's own
  // response is irrelevant to the consuming-event join and is left out.
  ...(event.auditID === stored03.source.auditID ? { stored: stored03.stored } : {}),
}));
if (!realEvents.some(event => event.stored !== undefined)) {
  throw new Error("the stored-object fixture names an audit event the 03 evidence does not contain");
}
const use1 = must(live03.useState[0], "the first use-state row");
const use2 = must(live03.useState[1], "the second use-state row");
const grant1: Held = {
  grant: stored03.grant,
  consumerAdmissionUid: use1.admissionUid,
  priorResourceVersion: stored03.priorResourceVersion,
};
// Grant 2 was admitted against the object grant 1 stored (rv 710). Its own
// target hash is not in any committed fixture, so it is left unset and no
// check below compares a stored object against it.
const grant2: Held = {
  grant: { grantId: use2.grantId, resourceUid: stored03.grant.resourceUid },
  consumerAdmissionUid: use2.admissionUid,
  priorResourceVersion: stored03.stored.metadata.resourceVersion,
};
const withVersion = (object: KubernetesObject, resourceVersion: string, replicas: number): KubernetesObject => ({
  ...object,
  metadata: { ...object.metadata, resourceVersion },
  spec: { ...object.spec, replicas },
});
/** Modeled read after 03's run: grant 2 was rejected and nothing else wrote, so rv 710 stands. */
const readAfterRun: Read = { kind: "present", object: stored03.stored };
const consumingEventOf = (held: Held): AuditEvent =>
  must(realEvents.find(event => event.admissionUid === held.consumerAdmissionUid), "the consuming event");
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

  it("the same audit id carrying different content is a conflict, not a choice", async () => {
    const altered = { ...consumingEventOf(grant2), code: 200 };
    expect(await auditOnly(grant2, [...realEvents, altered])).toBe("unknown_conflicting_events");
  });

  it("honest redelivery of an identical event stays definite", async () => {
    const redelivered = [...realEvents, { ...consumingEventOf(grant1) }, { ...consumingEventOf(grant2) }];
    expect(await auditOnly(grant1, redelivered)).toBe("audit_reports_stored");
    expect(await auditOnly(grant2, redelivered)).toBe("audit_reports_rejected");
  });

  it("an altered stored object that no longer matches the grant is caught by the grant itself", async () => {
    const altered = { ...consumingEventOf(grant1), stored: withVersion(stored03.stored, "710", 9) };
    expect(await auditOnly(grant1, replace(realEvents, consumingEventOf(grant1), altered))).toBe("audit_inconsistent_with_grant");
  });

  it("a status or verb the contract does not recognize is unknown, never stored", async () => {
    for (const code of [0, 100, 304, 700]) {
      const odd = { ...consumingEventOf(grant1), code, stored: undefined };
      expect(await auditOnly(grant1, replace(realEvents, consumingEventOf(grant1), odd))).toBe("unknown_unrecognized_event");
    }
    const read = { ...consumingEventOf(grant1), verb: "get" };
    expect(await auditOnly(grant1, replace(realEvents, consumingEventOf(grant1), read))).toBe("unknown_unrecognized_event");
  });

  it("a dry-run is recognized under any query spelling", async () => {
    const dryRun = { ...consumingEventOf(grant1), requestURI: "/apis/apps/v1/namespaces/x/deployments/web?DRYRUN=All" };
    expect(await auditOnly(grant1, replace(realEvents, consumingEventOf(grant1), dryRun))).toBe("audit_inconsistent_with_grant");
  });

  it("fails closed at its edges: no consumer record, and no read", async () => {
    const unconsumed: Held = { grant: grant1.grant, priorResourceVersion: grant1.priorResourceVersion };
    expect(await auditOnly(unconsumed, realEvents)).toBe("unknown_not_consumed");
    expect(await auditPlusRead(grant1, realEvents, { kind: "unavailable" })).toBe("audit_reports_stored");
    const flipped = { ...consumingEventOf(grant2), code: 200 };
    const events = replace(realEvents, consumingEventOf(grant2), flipped);
    expect(await auditPlusRead(grant2, events, { kind: "unavailable" })).toBe("audit_reports_stored");
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
    expect(await kubernetesObjectSha256(must(fabricated.stored, "the fabricated object"))).toBe(grant1.grant.objectSha256);
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
    const withoutPrior: Held = { grant: grant2.grant, consumerAdmissionUid: grant2.consumerAdmissionUid };
    expect(await auditPlusRead(withoutPrior, replace(realEvents, consumingEventOf(grant2), flipped), readAfterRun)).toBe("audit_reports_stored");
  });

  it("a controller's status-only update moves the version, so the equality check abstains and the flip stands", async () => {
    // Review finding: controllers bump resourceVersion by writing status,
    // which this contract's equality check reads as "something was stored".
    // It abstains (a missed catch), never a wrong catch — but the catch
    // window is shorter than the table in the note suggests.
    const flipped = { ...consumingEventOf(grant2), code: 200 };
    const events = replace(realEvents, consumingEventOf(grant2), flipped);
    const afterStatusUpdate: Read = { kind: "present", object: withVersion(stored03.stored, "715", 4) };
    expect(await auditPlusRead(grant2, events, afterStatusUpdate)).toBe("audit_reports_stored");
  });
});

describe("M4-04 the reverse attack, and what a carrier-aware read changes", () => {
  const hidden = (): AuditEvent => {
    const real = consumingEventOf(grant1);
    return {
      auditID: real.auditID, admissionUid: real.admissionUid, grantId: real.grantId,
      outcome: real.outcome, verb: real.verb, requestURI: real.requestURI, code: 500,
    };
  };

  it("hiding a stored write behind a 500 is not caught by a version-based read", async () => {
    // Not pre-registered. The version rule only ever cross-checks "stored".
    const events = replace(realEvents, consumingEventOf(grant1), hidden());
    expect(await auditOnly(grant1, events)).toBe("audit_reports_rejected");
    expect(await auditPlusRead(grant1, events, readAfterRun)).toBe("audit_reports_rejected");
  });

  it("a read that holds the grant's target and carries its id catches it, where the tier makes the carrier unforgeable", async () => {
    // Review finding on PR #80: the 'never caught' reading overgeneralized
    // from the version rule. The read here hashes to the grant's target,
    // has the grant's uid, and carries the grant's id.
    const events = replace(realEvents, consumingEventOf(grant1), hidden());
    expect(await auditPlusRead(grant1, events, readAfterRun, { carrierWritableOutsideEnforcer: false })).toBe("contradicted_by_read");
  });

  it("the same rule is wrong where another writer can set the carrier: it contradicts a true rejection", async () => {
    // Grant 2's rejection was real. A writer outside the enforcer's
    // webhook (a tier that fails open) reproduces the target state and
    // copies the carrier it read off the object. The read then holds the
    // target and names the grant, and the contract wrongly contradicts the
    // truthful audit event. The grant 1 target stands in for grant 2's,
    // which is not in any fixture.
    const grant2WithTarget: Held = {
      ...grant2,
      grant: { ...grant2.grant, grantId: carrierGrantId(stored03.stored) ?? "", objectSha256: stored03.grant.objectSha256 },
    };
    const rejected = { ...consumingEventOf(grant2), grantId: grant2WithTarget.grant.grantId };
    const events = replace(realEvents, consumingEventOf(grant2), rejected);
    expect(await auditOnly(grant2WithTarget, events)).toBe("audit_reports_rejected");
    expect(await auditPlusRead(grant2WithTarget, events, readAfterRun, { carrierWritableOutsideEnforcer: false })).toBe("contradicted_by_read");
    expect(await auditPlusRead(grant2WithTarget, events, readAfterRun)).toBe("audit_reports_rejected");
  });
});

describe("M4-04 vocabulary", () => {
  it("every verdict the contracts returned names its source; none reads as an attestation", () => {
    const seen = [...returned];
    // Every verdict in the contract's vocabulary was exercised by a test above.
    for (const verdict of [...AUDIT_VERDICTS, ...READ_VERDICTS]) expect(seen).toContain(verdict);
    for (const verdict of seen) {
      expect(verdict).toMatch(/^(unknown_|audit_|contradicted_)/);
      expect(verdict).not.toMatch(/persist|verified|proven|success|realized/);
    }
  });
});
