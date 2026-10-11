import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compareResourceVersions } from "./resource-version";

/**
 * M4 experiment 05 (docs/M4_EXPERIMENT_05.md), replayed offline against the
 * watch the live kind run recorded. The fixture is the run's
 * m4-watch-evidence.json with its provenance; nothing here talks to a
 * cluster. The contract is test-local, per docs/M4_DECISION.md.
 *
 * The attacks are 04's, applied to *audit claims*, with the watch as the
 * observer. The watch stream is outside the audit-pipeline adversary's
 * reach (docs/M4_EXPERIMENT_04.md), and as trustworthy as the API server
 * that answered it, the same as a read.
 */

const DeploymentEvent = z.object({
  type: z.string(),
  resourceVersion: z.string(),
  uid: z.string(),
  replicas: z.number().optional(),
  carrierGrantId: z.string().optional(),
  objectHash: z.string(),
  // null for the first event: its predecessor was not seen.
  hashChangedFromPrevious: z.boolean().nullable(),
  matchesGrant: z.array(z.string()),
}).passthrough();
const OtherEvent = z.object({ type: z.string(), resourceVersion: z.string().optional() }).passthrough();

const Fixture = z.object({
  source: z.object({ ciRun: z.string().url(), artifactSha256: z.string().regex(/^[0-9a-f]{64}$/) }).passthrough(),
  watchStartResourceVersion: z.string(),
  /** The object's version when the watch was closed; a complete stream's last event carries it. */
  closedAtResourceVersion: z.string(),
  watchAliveAtClose: z.boolean(),
  lastEventMatchesClose: z.boolean(),
  grants: z.array(z.object({ grantId: z.string(), objectSha256: z.string(), resourceUid: z.string() })),
  useState: z.array(z.object({ grant_id: z.string(), admission_uid: z.string() })),
  audit: z.array(z.object({
    auditID: z.string(), grantId: z.string(), admissionUid: z.string(), outcome: z.string(),
    code: z.number().int(), isDryRun: z.boolean(), storedResourceVersion: z.string().optional(),
  })),
  watchEvents: z.array(z.union([DeploymentEvent, OtherEvent])),
});
const fixture = Fixture.parse(JSON.parse(readFileSync(
  path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-watch-events.json"), "utf8")));

type WatchEvent = z.infer<typeof DeploymentEvent>;
const isDeployment = (event: z.infer<typeof DeploymentEvent> | z.infer<typeof OtherEvent>): event is WatchEvent =>
  "uid" in event && typeof event.uid === "string" && "objectHash" in event;
const deploymentEvents = fixture.watchEvents.filter(isDeployment);

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`fixture is missing ${what}`);
  return value;
};
const grant1 = must(fixture.grants[0], "grant 1");
const grant2 = must(fixture.grants[1], "grant 2");
/**
 * The version the dry-run's response carried: what grant 1's admission saw.
 * For grant 2, whose own oldObject version no artifact records, it is a
 * *lower bound*: grant 2 was admitted later against the same object, and
 * versions only rise. Using a lower bound is safe in both directions this
 * contract uses it: the stream must start at or before it (a stricter
 * coverage test than the true prior), and the event window opens at it (a
 * wider window can only find more target events, so absence is stronger).
 */
const PRIOR_RV = must(fixture.audit.find(event => event.isDryRun)?.storedResourceVersion, "the dry-run's version");

interface Stream {
  /** Where the stream began. It covers the admission only if it began at or before the prior version. */
  fromResourceVersion: string;
  /** The object's version when the stream was closed, if recorded. A complete stream's last event carries it. */
  closedAtResourceVersion?: string;
  events: WatchEvent[];
}
const fullStream: Stream = {
  fromResourceVersion: fixture.watchStartResourceVersion,
  closedAtResourceVersion: fixture.closedAtResourceVersion,
  events: deploymentEvents,
};

const WATCH_VERDICTS = [
  "watch_holds_target_with_carrier",
  "watch_holds_target_without_carrier",
  "watch_holds_no_target_state",
  "unknown_stream_does_not_cover_admission",
  "unknown_stream_truncated",
  "unknown_stream_out_of_order",
] as const;
type WatchVerdict = (typeof WATCH_VERDICTS)[number];
const RECONCILED = [
  "agrees_stored",
  "agrees_rejected",
  "claim_contradicted_by_watch",
  "claim_unchecked_watch_unknown",
  "claim_stored_state_unattributed",
] as const;
type Reconciled = (typeof RECONCILED)[number];

/**
 * What the stream says about one grant's write, given the version the
 * enforcer saw at admission.
 *
 * A target event that is present is positive evidence even from a stream
 * that was cut short. Absence is evidence only when the stream provably
 * covers the window: it began at or before the prior version AND its last
 * event carries the object's version at close, so nothing after the last
 * event was missed. An event dropped from the *middle* of an otherwise
 * complete stream is not detectable from the stream alone; that is a stated
 * limit, and an adversary inside the observer's own path is out of scope.
 */
function fromWatch(
  grant: { grantId: string; objectSha256: string; resourceUid: string },
  priorResourceVersion: string,
  stream: Stream,
): WatchVerdict {
  const versions = stream.events.map(event => event.resourceVersion);
  const ordered = versions.every((version, index) =>
    index === 0 || compareResourceVersions(must(versions[index - 1], "a version"), version) === -1);
  if (!ordered) return "unknown_stream_out_of_order";

  const holding = stream.events.find(event =>
    event.uid === grant.resourceUid &&
    event.matchesGrant.includes(grant.grantId) &&
    compareResourceVersions(event.resourceVersion, priorResourceVersion) === 1);
  if (holding !== undefined) {
    return holding.carrierGrantId === grant.grantId ? "watch_holds_target_with_carrier" : "watch_holds_target_without_carrier";
  }

  const start = compareResourceVersions(stream.fromResourceVersion, priorResourceVersion);
  if (start === undefined || start === 1) return "unknown_stream_does_not_cover_admission";
  const last = stream.events[stream.events.length - 1];
  const reachesClose =
    stream.closedAtResourceVersion !== undefined &&
    (last === undefined
      ? stream.closedAtResourceVersion === stream.fromResourceVersion
      : last.resourceVersion === stream.closedAtResourceVersion);
  if (!reachesClose) return "unknown_stream_truncated";
  return "watch_holds_no_target_state";
}

type Claim = "stored" | "rejected";

/** An audit claim next to the watch's account of the same grant. */
function reconcile(claim: Claim, watch: WatchVerdict): Reconciled {
  if (watch.startsWith("unknown_")) return "claim_unchecked_watch_unknown";
  if (watch === "watch_holds_target_without_carrier") {
    return claim === "stored" ? "claim_stored_state_unattributed" : "claim_contradicted_by_watch";
  }
  const holdsTarget = watch === "watch_holds_target_with_carrier";
  if (claim === "stored") return holdsTarget ? "agrees_stored" : "claim_contradicted_by_watch";
  return holdsTarget ? "claim_contradicted_by_watch" : "agrees_rejected";
}

/** The audit's claim, from the event the enforcer recorded as the consumer, not the first naming the grant. */
const auditClaimOf = (grantId: string): Claim => {
  const consumer = must(fixture.useState.find(row => row.grant_id === grantId), "a use-state row").admission_uid;
  const consumed = must(fixture.audit.find(event => event.admissionUid === consumer), "the consuming audit event");
  return consumed.code >= 200 && consumed.code < 300 ? "stored" : "rejected";
};

const hashChanged = (index: number): boolean =>
  index === 0 ? true : must(deploymentEvents[index], "an event").objectHash !== must(deploymentEvents[index - 1], "the previous event").objectHash;

describe("M4-05 live evidence: what the independent watch holds", () => {
  it("the stream was alive and complete when it was closed", () => {
    expect(fixture.watchAliveAtClose).toBe(true);
    expect(fixture.lastEventMatchesClose).toBe(true);
    expect(must(deploymentEvents[deploymentEvents.length - 1], "the last event").resourceVersion).toBe(fixture.closedAtResourceVersion);
  });

  it("H5a: grant 1's stored write is one event, with its hash, uid, carrier and the audit's version", () => {
    const first = must(deploymentEvents.find(event => event.matchesGrant.includes(grant1.grantId)), "grant 1's first matching event");
    expect(first.type).toBe("MODIFIED");
    expect(hashChanged(deploymentEvents.indexOf(first))).toBe(true);
    expect(first.uid).toBe(grant1.resourceUid);
    expect(first.carrierGrantId).toBe(grant1.grantId);
    const consumer = must(fixture.useState.find(row => row.grant_id === grant1.grantId), "grant 1's use-state row").admission_uid;
    const audited = fixture.audit.find(event => event.admissionUid === consumer);
    expect(first.resourceVersion).toBe(audited?.storedResourceVersion);
  });

  it("H5b: nothing in the stream names or matches grant 2, which the audit says was rejected", () => {
    expect(deploymentEvents.filter(event => event.carrierGrantId === grant2.grantId)).toEqual([]);
    expect(deploymentEvents.filter(event => event.matchesGrant.includes(grant2.grantId))).toEqual([]);
    expect(fromWatch(grant2, PRIOR_RV, fullStream)).toBe("watch_holds_no_target_state");
  });

  it("H5c: version advances with an unchanged spec hash follow the write, and every one still names the grant", () => {
    const write = must(deploymentEvents.find(event => event.matchesGrant.includes(grant1.grantId)), "the write's event");
    const writeIndex = deploymentEvents.indexOf(write);
    const unchanged = deploymentEvents.map((event, index) => ({ event, index })).filter(({ index }) => index > 0 && !hashChanged(index));
    expect(unchanged.filter(({ index }) => index > writeIndex).length).toBeGreaterThan(0);
    // Every later such event still names grant 1: a count of events naming
    // a grant is not a count of writes.
    expect(deploymentEvents.filter(event => event.carrierGrantId === grant1.grantId).length).toBeGreaterThan(1);
  });

  it("the read taken before the first write is older than the admission's version", () => {
    // The watch opened at the version read before step 1, and an event
    // landed before the dry-run, so the version the enforcer saw is newer.
    expect(compareResourceVersions(fixture.watchStartResourceVersion, PRIOR_RV)).toBe(-1);
  });

  it("run A (a different CI run) had status-only events between that read and the write", () => {
    // Kept as its own fixture because the first live run is what the note's
    // first results describe. Across the three live runs the number of
    // events between the pre-write read and the write was 2, 0 and 0 (plus
    // an unclassifiable first event), so it is not a constant.
    const RunA = z.object({
      source: z.object({ ciRun: z.string().url() }).passthrough(),
      watchStartResourceVersion: z.string(),
      audit: z.array(z.object({ isDryRun: z.boolean(), storedResourceVersion: z.string().optional() })),
      watchEvents: z.array(z.object({ resourceVersion: z.string(), objectHash: z.string(), matchesGrant: z.array(z.string()) })),
    });
    const runA = RunA.parse(JSON.parse(readFileSync(
      path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-watch-events-run-a.json"), "utf8")));
    const prior = must(runA.audit.find(event => event.isDryRun)?.storedResourceVersion, "run A's dry-run version");
    expect(compareResourceVersions(runA.watchStartResourceVersion, prior)).toBe(-1);
    const before = runA.watchEvents.filter(event =>
      compareResourceVersions(event.resourceVersion, runA.watchStartResourceVersion) === 1 &&
      compareResourceVersions(event.resourceVersion, prior) !== 1);
    expect(before.length).toBe(3);
    const hashes = before.map(event => event.objectHash);
    // Two of the three left the spec hash unchanged from the one before; the
    // first has no predecessor in the stream, so it is not classed.
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(hashes[1]);
  });
});

describe("M4-05 attacks 04 could not settle, with the watch as observer", () => {
  it("baseline: the watch agrees with both truthful audit claims", () => {
    expect(auditClaimOf(grant1.grantId)).toBe("stored");
    expect(auditClaimOf(grant2.grantId)).toBe("rejected");
    expect(reconcile(auditClaimOf(grant1.grantId), fromWatch(grant1, PRIOR_RV, fullStream))).toBe("agrees_stored");
    expect(reconcile(auditClaimOf(grant2.grantId), fromWatch(grant2, PRIOR_RV, fullStream))).toBe("agrees_rejected");
  });

  it("H5d: hiding grant 1's stored write behind a 500 is contradicted", () => {
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, fullStream))).toBe("claim_contradicted_by_watch");
  });

  it("H5e: a flipped or fabricated 'stored' claim for grant 2 is contradicted", () => {
    // 04's H4c (flip a 500 to 200) and H4d (fabricate a 200 carrying the
    // target) are the same claim as far as the watch is concerned.
    expect(reconcile("stored", fromWatch(grant2, PRIOR_RV, fullStream))).toBe("claim_contradicted_by_watch");
  });

  it("a stream that began after the admission leaves every claim unchecked, not contradicted", () => {
    const late: Stream = {
      fromResourceVersion: "710",
      closedAtResourceVersion: fixture.closedAtResourceVersion,
      events: deploymentEvents.filter(event => compareResourceVersions(event.resourceVersion, "710") === 1),
    };
    // grant 1's write is before the late start, so its absence proves nothing.
    expect(fromWatch(grant1, PRIOR_RV, late)).toBe("unknown_stream_does_not_cover_admission");
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, late))).toBe("claim_unchecked_watch_unknown");
    expect(reconcile("stored", fromWatch(grant2, PRIOR_RV, late))).toBe("claim_unchecked_watch_unknown");
  });

  it("a stream cut short is unknown for absence, never a contradiction of a true claim", () => {
    // Review finding: only the start of the stream was checked. This one
    // ends before the write is delivered, so grant 1's truthful "stored"
    // claim must not read as contradicted.
    const writeIndex = deploymentEvents.findIndex(event => event.matchesGrant.includes(grant1.grantId));
    const cut: Stream = { ...fullStream, events: deploymentEvents.slice(0, writeIndex) };
    expect(fromWatch(grant1, PRIOR_RV, cut)).toBe("unknown_stream_truncated");
    expect(reconcile("stored", fromWatch(grant1, PRIOR_RV, cut))).toBe("claim_unchecked_watch_unknown");
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, cut))).toBe("claim_unchecked_watch_unknown");
  });

  it("a stream with no recorded close is unknown for absence, as is one that was never closed cleanly", () => {
    const unmarked: Stream = { ...fullStream, closedAtResourceVersion: undefined };
    expect(fromWatch(grant2, PRIOR_RV, unmarked)).toBe("unknown_stream_truncated");
    const lagging: Stream = { ...fullStream, closedAtResourceVersion: "999999" };
    expect(fromWatch(grant2, PRIOR_RV, lagging)).toBe("unknown_stream_truncated");
  });

  it("a cut stream that already holds the target still shows it", () => {
    const writeIndex = deploymentEvents.findIndex(event => event.matchesGrant.includes(grant1.grantId));
    const cutAfterWrite: Stream = { ...fullStream, closedAtResourceVersion: undefined, events: deploymentEvents.slice(0, writeIndex + 1) };
    expect(fromWatch(grant1, PRIOR_RV, cutAfterWrite)).toBe("watch_holds_target_with_carrier");
  });

  it("events out of order are unknown", () => {
    const reordered: Stream = { ...fullStream, events: [...deploymentEvents].reverse() };
    expect(fromWatch(grant2, PRIOR_RV, reordered)).toBe("unknown_stream_out_of_order");
  });

  it("LIMIT: an event dropped from the middle of an otherwise complete stream is not detectable", () => {
    // Stated, not solved. Versions are cluster-global, so a gap in numbers
    // is not a gap in this object's history, and the stream carries no
    // sequence number. An adversary in the observer's own path (a proxy
    // that edits the stream) is outside the attack model, as for a read.
    const writeIndex = deploymentEvents.findIndex(event => event.matchesGrant.includes(grant1.grantId));
    const dropped: Stream = { ...fullStream, events: deploymentEvents.filter((_, index) => index !== writeIndex) };
    expect(fromWatch(grant1, PRIOR_RV, dropped)).toBe("watch_holds_target_with_carrier");
    const droppedAllMatches: Stream = {
      ...fullStream,
      events: deploymentEvents.filter(event => !event.matchesGrant.includes(grant1.grantId)),
    };
    expect(fromWatch(grant1, PRIOR_RV, droppedAllMatches)).toBe("unknown_stream_truncated");
  });

  it("target state without the carrier is unattributed, not stored", () => {
    // 01's convergent re-apply: another writer produced the target state
    // and the carrier is gone. In this tier a write without a consumed
    // grant is denied, so this should not occur; if it does, the verdict
    // must not read as the grant's write.
    const stripped: Stream = { ...fullStream, events: deploymentEvents.map(event => ({ ...event, carrierGrantId: undefined })) };
    expect(fromWatch(grant1, PRIOR_RV, stripped)).toBe("watch_holds_target_without_carrier");
    expect(reconcile("stored", fromWatch(grant1, PRIOR_RV, stripped))).toBe("claim_stored_state_unattributed");
  });

  it("a carrier naming the grant on the wrong state does not count as the write", () => {
    const wrongState: Stream = { ...fullStream, events: deploymentEvents.map(event => ({ ...event, matchesGrant: [] })) };
    expect(fromWatch(grant1, PRIOR_RV, wrongState)).toBe("watch_holds_no_target_state");
  });
});

describe("M4-05 vocabulary", () => {
  it("every verdict is reachable, and none reads as an attestation of effect or authorship", () => {
    // A fixed table of inputs, one per verdict, independent of test order.
    const writeIndex = deploymentEvents.findIndex(event => event.matchesGrant.includes(grant1.grantId));
    const late: Stream = {
      fromResourceVersion: "710",
      closedAtResourceVersion: fixture.closedAtResourceVersion,
      events: deploymentEvents.filter(event => compareResourceVersions(event.resourceVersion, "710") === 1),
    };
    const stripped: Stream = { ...fullStream, events: deploymentEvents.map(event => ({ ...event, carrierGrantId: undefined })) };
    const watchTable: Array<[WatchVerdict, WatchVerdict]> = [
      ["watch_holds_target_with_carrier", fromWatch(grant1, PRIOR_RV, fullStream)],
      ["watch_holds_target_without_carrier", fromWatch(grant1, PRIOR_RV, stripped)],
      ["watch_holds_no_target_state", fromWatch(grant2, PRIOR_RV, fullStream)],
      ["unknown_stream_does_not_cover_admission", fromWatch(grant1, PRIOR_RV, late)],
      ["unknown_stream_truncated", fromWatch(grant1, PRIOR_RV, { ...fullStream, events: deploymentEvents.slice(0, writeIndex) })],
      ["unknown_stream_out_of_order", fromWatch(grant2, PRIOR_RV, { ...fullStream, events: [...deploymentEvents].reverse() })],
    ];
    const reconciledTable: Array<[Reconciled, Reconciled]> = [
      ["agrees_stored", reconcile("stored", "watch_holds_target_with_carrier")],
      ["agrees_rejected", reconcile("rejected", "watch_holds_no_target_state")],
      ["claim_contradicted_by_watch", reconcile("rejected", "watch_holds_target_with_carrier")],
      ["claim_unchecked_watch_unknown", reconcile("stored", "unknown_stream_truncated")],
      ["claim_stored_state_unattributed", reconcile("stored", "watch_holds_target_without_carrier")],
    ];
    expect(watchTable.map(([expected]) => expected).sort()).toEqual([...WATCH_VERDICTS].sort());
    expect(reconciledTable.map(([expected]) => expected).sort()).toEqual([...RECONCILED].sort());
    for (const [expected, actual] of [...watchTable, ...reconciledTable]) {
      expect(actual).toBe(expected);
      expect(actual).not.toMatch(/persist|verified|proven|success|realized|applied/);
    }
  });
});
