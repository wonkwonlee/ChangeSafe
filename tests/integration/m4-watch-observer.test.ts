import { createHash } from "node:crypto";
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

const Evidence = z.object({
  watchStartResourceVersion: z.string().optional(),
  /** The object's version when the watch was closed; a complete stream's last event carries it. */
  closedAtResourceVersion: z.string().nullable().optional(),
  watchAliveAtClose: z.boolean().nullable().optional(),
  watchStderr: z.string().optional(),
  lastEventMatchesClose: z.boolean().optional(),
  /**
   * In-band ERROR events (a 410 Gone, a too-old version), recorded apart from
   * the Deployment events by the current summary script. Absent in an
   * artifact that predates the field; there the ERROR events, if any, are in
   * watchEvents with type ERROR.
   */
  errorEvents: z.array(z.unknown()).optional(),
  unparsedLines: z.number().optional(),
  grants: z.array(z.object({ grantId: z.string(), objectSha256: z.string(), resourceUid: z.string() })),
  useState: z.array(z.object({ grant_id: z.string(), admission_uid: z.string() })),
  audit: z.array(z.object({
    auditID: z.string(), grantId: z.string(), admissionUid: z.string(), outcome: z.string(),
    code: z.number().int(), isDryRun: z.boolean(), storedResourceVersion: z.string().optional(),
  })),
  watchEvents: z.array(z.union([DeploymentEvent, OtherEvent])),
});
const Manifest = z.object({
  ciRun: z.string().url(),
  watchStartResourceVersion: z.string().optional(),
  files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
});

/** A live run's raw artifact, committed byte for byte and checked against its manifest hash before use. */
function loadRun(directory: string) {
  const dir = path.resolve("examples/m2-kubernetes-enforcer/evidence", directory);
  const manifest = Manifest.parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
  const bytes = readFileSync(path.join(dir, "m4-watch-evidence.json"));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.files["m4-watch-evidence.json"]) {
    throw new Error(`${directory}/m4-watch-evidence.json does not match its manifest hash`);
  }
  const evidence = Evidence.parse(JSON.parse(bytes.toString("utf8")));
  const startVersion = evidence.watchStartResourceVersion ?? manifest.watchStartResourceVersion;
  if (startVersion === undefined) throw new Error(`${directory} records no watch start version`);
  return { manifest, evidence, startVersion };
}
const runC = loadRun("2026-10-11-run-c");
const fixture = { ...runC.evidence, watchStartResourceVersion: runC.startVersion };

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
 * The version each grant's admission saw, as far as the evidence says.
 *
 * Grant 1: its own dry-run's response (the enforcer does not record
 * oldObject today, proposal P3). Grant 2 has no dry-run in the artifact.
 * It was admitted after grant 1's write was stored (the harness issues it
 * from a snapshot taken then), and versions only rise, so grant 1's stored
 * version is a LOWER BOUND of grant 2's. A lower bound is safe for the
 * coverage check (the stream must start at or before the true prior, and
 * starting before a lower bound is stricter) and for absence. It is NOT
 * safe for presence: an earlier window can contain another writer's event
 * that hashes to the grant's target. The carrier check below is what stops
 * that being attributed, and the exact version (P3) removes the window.
 */
function priorOf(grantId: string): string {
  const own = fixture.audit.find(event => event.isDryRun && event.grantId === grantId);
  if (own?.storedResourceVersion !== undefined) return own.storedResourceVersion;
  const firstConsumer = must(fixture.useState[0], "grant 1's use-state row").admission_uid;
  return must(fixture.audit.find(event => event.admissionUid === firstConsumer)?.storedResourceVersion, "grant 1's stored version");
}
const PRIOR_RV = priorOf(grant1.grantId);
const PRIOR_RV_2 = priorOf(grant2.grantId);

interface Stream {
  /** Where the stream began. It covers the admission only if it began at or before the prior version. */
  fromResourceVersion: string;
  /** The object's version when the stream was closed, if recorded. A complete stream's last event carries it. */
  closedAtResourceVersion?: string;
  /** Alive when closed, nothing on stderr, no in-band ERROR event. False or absent means "not known complete". */
  endedCleanly: boolean;
  events: WatchEvent[];
}
/** Alive when closed, nothing on stderr, no in-band ERROR event under either recording, no unparsed line. */
const endedCleanly =
  fixture.watchAliveAtClose === true &&
  fixture.watchStderr === "" &&
  !fixture.watchEvents.some(event => event.type === "ERROR") &&
  (fixture.errorEvents?.length ?? 0) === 0 &&
  (fixture.unparsedLines ?? 0) === 0;
const fullStream: Stream = {
  fromResourceVersion: fixture.watchStartResourceVersion,
  closedAtResourceVersion: fixture.closedAtResourceVersion ?? undefined,
  endedCleanly,
  events: deploymentEvents,
};

const WATCH_VERDICTS = [
  "watch_holds_target_with_carrier",
  "watch_holds_target_without_carrier",
  "watch_holds_no_target_state",
  "unknown_stream_does_not_cover_admission",
  "unknown_stream_truncated",
  "unknown_stream_ended_abnormally",
  "unknown_stream_out_of_order",
] as const;
type WatchVerdict = (typeof WATCH_VERDICTS)[number];
const RECONCILED = [
  "agrees_stored",
  "agrees_rejected",
  "claim_contradicted_by_watch",
  "claim_unchecked_watch_unknown",
  "target_state_unattributed",
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
  if (!stream.endedCleanly) return "unknown_stream_ended_abnormally";
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
  // The state exists but nothing ties it to this grant, so neither claim is
  // contradicted: a truthful "rejected" must not be called a lie because
  // another writer converged the object to the same target.
  if (watch === "watch_holds_target_without_carrier") return "target_state_unattributed";
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

/** The stream's start for the "began too late" cases: after the write, so after both admissions. */
const WRITE_INDEX = deploymentEvents.findIndex(event => event.matchesGrant.includes(grant1.grantId));
const LATE_START = must(deploymentEvents[WRITE_INDEX + 1], "an event after the write").resourceVersion;
const lateStream = (): Stream => ({
  fromResourceVersion: LATE_START,
  closedAtResourceVersion: fixture.closedAtResourceVersion ?? undefined,
  endedCleanly: true,
  events: deploymentEvents.filter(event => compareResourceVersions(event.resourceVersion, LATE_START) === 1),
});

const hashChanged = (index: number): boolean =>
  index === 0 ? true : must(deploymentEvents[index], "an event").objectHash !== must(deploymentEvents[index - 1], "the previous event").objectHash;

describe("M4-05 live evidence: what the independent watch holds", () => {
  it("an in-band ERROR event, recorded apart from the stream's events, makes it not clean", () => {
    // Review finding: the summary stores ERROR events in errorEvents, not in
    // watchEvents, so a predicate that looked only at watchEvents could never
    // see one and would call a failed stream clean.
    const clean = (errorEvents: unknown[] | undefined) =>
      fixture.watchAliveAtClose === true && fixture.watchStderr === "" &&
      !fixture.watchEvents.some(event => event.type === "ERROR") && (errorEvents?.length ?? 0) === 0;
    expect(clean(undefined)).toBe(true);
    expect(clean([])).toBe(true);
    expect(clean([{ code: 410, reason: "Expired" }])).toBe(false);
  });

  it("the stream was alive and complete when it was closed", () => {
    expect(fixture.watchAliveAtClose).toBe(true);
    expect(fixture.watchStderr).toBe("");
    expect(fixture.watchEvents.filter(event => event.type === "ERROR")).toEqual([]);
    expect(fixture.lastEventMatchesClose).toBe(true);
    expect(must(deploymentEvents[deploymentEvents.length - 1], "the last event").resourceVersion).toBe(fixture.closedAtResourceVersion);
  });

  it("the summary's derived hash-change flag agrees with the hashes, and the first event is unclassified", () => {
    const first = must(deploymentEvents[0], "the first event");
    expect(first.hashChangedFromPrevious).toBeNull();
    deploymentEvents.forEach((event, index) => {
      if (index > 0) expect(event.hashChangedFromPrevious).toBe(hashChanged(index));
    });
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
    expect(fromWatch(grant2, PRIOR_RV_2, fullStream)).toBe("watch_holds_no_target_state");
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
    // Kept as its own committed artifact because the note's first results
    // describe this run. Across the three live runs the number of events
    // between the pre-write read and the write was 2, 0 and 0 (plus an
    // unclassifiable first event), so it is not a constant.
    const runA = loadRun("2026-10-11-run-a");
    const prior = must(runA.evidence.audit.find(event => event.isDryRun)?.storedResourceVersion, "run A's dry-run version");
    expect(compareResourceVersions(runA.startVersion, prior)).toBe(-1);
    const before = runA.evidence.watchEvents.filter(isDeployment).filter(event =>
      compareResourceVersions(event.resourceVersion, runA.startVersion) === 1 &&
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
    expect(reconcile(auditClaimOf(grant2.grantId), fromWatch(grant2, PRIOR_RV_2, fullStream))).toBe("agrees_rejected");
  });

  it("H5d: hiding grant 1's stored write behind a 500 is contradicted", () => {
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, fullStream))).toBe("claim_contradicted_by_watch");
  });

  it("H5e: a flipped or fabricated 'stored' claim for grant 2 is contradicted", () => {
    // 04's H4c (flip a 500 to 200) and H4d (fabricate a 200 carrying the
    // target) are the same claim as far as the watch is concerned.
    expect(reconcile("stored", fromWatch(grant2, PRIOR_RV_2, fullStream))).toBe("claim_contradicted_by_watch");
  });

  it("a stream that began after the admission cannot show absence, but still shows a target that persists", () => {
    const late = lateStream();
    // Absence proves nothing from a stream that started after the admission.
    expect(fromWatch(grant2, PRIOR_RV_2, late)).toBe("unknown_stream_does_not_cover_admission");
    expect(reconcile("stored", fromWatch(grant2, PRIOR_RV_2, late))).toBe("claim_unchecked_watch_unknown");
    // Presence survives: later events still hash to the target and carry the
    // grant, which an unforgeable carrier ties to the consuming admission. So
    // even a late watch contradicts a hidden-write "rejected" claim.
    expect(fromWatch(grant1, PRIOR_RV, late)).toBe("watch_holds_target_with_carrier");
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, late))).toBe("claim_contradicted_by_watch");
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
    expect(fromWatch(grant2, PRIOR_RV_2, unmarked)).toBe("unknown_stream_truncated");
    const lagging: Stream = { ...fullStream, closedAtResourceVersion: "999999" };
    expect(fromWatch(grant2, PRIOR_RV_2, lagging)).toBe("unknown_stream_truncated");
  });

  it("a stream that ended abnormally is unknown for absence even when its last event matches", () => {
    // Review finding: the last event's version alone does not show the
    // stream was alive or error-free at the end.
    const died: Stream = { ...fullStream, endedCleanly: false };
    expect(fromWatch(grant2, PRIOR_RV_2, died)).toBe("unknown_stream_ended_abnormally");
    expect(fromWatch(grant1, PRIOR_RV, died)).toBe("watch_holds_target_with_carrier");
  });

  it("a cut stream that already holds the target still shows it", () => {
    const writeIndex = deploymentEvents.findIndex(event => event.matchesGrant.includes(grant1.grantId));
    const cutAfterWrite: Stream = { ...fullStream, closedAtResourceVersion: undefined, events: deploymentEvents.slice(0, writeIndex + 1) };
    expect(fromWatch(grant1, PRIOR_RV, cutAfterWrite)).toBe("watch_holds_target_with_carrier");
  });

  it("events out of order are unknown", () => {
    const reordered: Stream = { ...fullStream, events: [...deploymentEvents].reverse() };
    expect(fromWatch(grant2, PRIOR_RV_2, reordered)).toBe("unknown_stream_out_of_order");
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
    expect(reconcile("stored", fromWatch(grant1, PRIOR_RV, stripped))).toBe("target_state_unattributed");
    // Symmetric for a truthful rejection: another writer reaching the same
    // target is not a lie by the audit, so it is not contradicted either.
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, stripped))).toBe("target_state_unattributed");
  });

  it("a carrier naming the grant on the wrong state does not count as the write", () => {
    const wrongState: Stream = { ...fullStream, events: deploymentEvents.map(event => ({ ...event, matchesGrant: [] })) };
    expect(fromWatch(grant1, PRIOR_RV, wrongState)).toBe("watch_holds_no_target_state");
  });
});

describe("M4-05 vocabulary", () => {
  it("every verdict is reachable, and none reads as an attestation of effect or authorship", () => {
    // A fixed table of inputs, one per verdict, independent of test order.
    const writeIndex = WRITE_INDEX;
    const late = lateStream();
    const stripped: Stream = { ...fullStream, events: deploymentEvents.map(event => ({ ...event, carrierGrantId: undefined })) };
    const watchTable: Array<[WatchVerdict, WatchVerdict]> = [
      ["watch_holds_target_with_carrier", fromWatch(grant1, PRIOR_RV, fullStream)],
      ["watch_holds_target_without_carrier", fromWatch(grant1, PRIOR_RV, stripped)],
      ["watch_holds_no_target_state", fromWatch(grant2, PRIOR_RV_2, fullStream)],
      ["unknown_stream_does_not_cover_admission", fromWatch(grant2, PRIOR_RV_2, late)],
      ["unknown_stream_truncated", fromWatch(grant1, PRIOR_RV, { ...fullStream, events: deploymentEvents.slice(0, writeIndex) })],
      ["unknown_stream_ended_abnormally", fromWatch(grant2, PRIOR_RV_2, { ...fullStream, endedCleanly: false })],
      ["unknown_stream_out_of_order", fromWatch(grant2, PRIOR_RV_2, { ...fullStream, events: [...deploymentEvents].reverse() })],
    ];
    const reconciledTable: Array<[Reconciled, Reconciled]> = [
      ["agrees_stored", reconcile("stored", "watch_holds_target_with_carrier")],
      ["agrees_rejected", reconcile("rejected", "watch_holds_no_target_state")],
      ["claim_contradicted_by_watch", reconcile("rejected", "watch_holds_target_with_carrier")],
      ["claim_unchecked_watch_unknown", reconcile("stored", "unknown_stream_truncated")],
      ["target_state_unattributed", reconcile("rejected", "watch_holds_target_without_carrier")],
    ];
    expect(watchTable.map(([expected]) => expected).sort()).toEqual([...WATCH_VERDICTS].sort());
    expect(reconciledTable.map(([expected]) => expected).sort()).toEqual([...RECONCILED].sort());
    for (const [expected, actual] of [...watchTable, ...reconciledTable]) {
      expect(actual).toBe(expected);
      expect(actual).not.toMatch(/persist|verified|proven|success|realized|applied/);
    }
  });
});
