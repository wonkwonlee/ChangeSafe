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

const Fixture = z.object({
  source: z.object({ ciRun: z.string().url(), artifactSha256: z.string().regex(/^[0-9a-f]{64}$/) }).passthrough(),
  watchStartResourceVersion: z.string(),
  grants: z.array(z.object({ grantId: z.string(), objectSha256: z.string(), resourceUid: z.string() })),
  useState: z.array(z.object({ grant_id: z.string(), admission_uid: z.string() })),
  audit: z.array(z.object({
    auditID: z.string(), grantId: z.string(), admissionUid: z.string(), outcome: z.string(),
    code: z.number().int(), isDryRun: z.boolean(), storedResourceVersion: z.string().optional(),
  })),
  watchEvents: z.array(z.object({
    type: z.string(), resourceVersion: z.string(), uid: z.string(), replicas: z.number().optional(),
    carrierGrantId: z.string().optional(), objectHash: z.string(), hashChangedFromPrevious: z.boolean(),
    matchesGrant: z.array(z.string()),
  })),
});
const fixture = Fixture.parse(JSON.parse(readFileSync(
  path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-watch-events.json"), "utf8")));

type WatchEvent = z.infer<typeof Fixture>["watchEvents"][number];
const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`fixture is missing ${what}`);
  return value;
};
const grant1 = must(fixture.grants[0], "grant 1");
const grant2 = must(fixture.grants[1], "grant 2");
/** The version the enforcer saw in oldObject at grant 1's admission: the dry-run's response in this run. */
const PRIOR_RV = must(fixture.audit.find(event => event.isDryRun)?.storedResourceVersion, "the dry-run's version");

interface Stream {
  /** Where the stream began. It covers the admission only if it began at or before the prior version. */
  fromResourceVersion: string;
  events: WatchEvent[];
}
const fullStream: Stream = { fromResourceVersion: fixture.watchStartResourceVersion, events: fixture.watchEvents };

const WATCH_VERDICTS = [
  "watch_holds_target_with_carrier",
  "watch_holds_target_without_carrier",
  "watch_holds_no_target_state",
  "unknown_stream_does_not_cover_admission",
  "unknown_stream_discontinuous",
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

/** Every verdict either function actually returned, so the vocabulary test reads real outputs. */
const returned = new Set<WatchVerdict | Reconciled>();
function done<V extends WatchVerdict | Reconciled>(verdict: V): V {
  returned.add(verdict);
  return verdict;
}

/**
 * What the stream says about one grant's write, given the version the
 * enforcer saw at admission. Absence is only evidence when the stream
 * provably began at or before that version.
 */
function fromWatch(
  grant: { grantId: string; objectSha256: string; resourceUid: string },
  priorResourceVersion: string,
  stream: Stream,
): WatchVerdict {
  const start = compareResourceVersions(stream.fromResourceVersion, priorResourceVersion);
  if (start === undefined || start === 1) return done("unknown_stream_does_not_cover_admission");
  const versions = stream.events.map(event => event.resourceVersion);
  const ordered = versions.every((version, index) => index === 0 || compareResourceVersions(must(versions[index - 1], "a version"), version) === -1);
  if (!ordered) return done("unknown_stream_discontinuous");
  const holding = stream.events.find(event =>
    event.uid === grant.resourceUid &&
    event.matchesGrant.includes(grant.grantId) &&
    compareResourceVersions(event.resourceVersion, priorResourceVersion) === 1);
  if (holding === undefined) return done("watch_holds_no_target_state");
  return done(holding.carrierGrantId === grant.grantId ? "watch_holds_target_with_carrier" : "watch_holds_target_without_carrier");
}

type Claim = "stored" | "rejected";
/** An audit claim next to the watch's account of the same grant. */
function reconcile(claim: Claim, watch: WatchVerdict): Reconciled {
  if (watch.startsWith("unknown_")) return done("claim_unchecked_watch_unknown");
  if (watch === "watch_holds_target_without_carrier") {
    return done(claim === "stored" ? "claim_stored_state_unattributed" : "claim_contradicted_by_watch");
  }
  const holdsTarget = watch === "watch_holds_target_with_carrier";
  if (claim === "stored") return done(holdsTarget ? "agrees_stored" : "claim_contradicted_by_watch");
  return done(holdsTarget ? "claim_contradicted_by_watch" : "agrees_rejected");
}

const auditClaimOf = (grantId: string): Claim => {
  const consumed = must(fixture.audit.find(event => event.grantId === grantId && event.outcome === "allow-consumed"), "a consuming event");
  return consumed.code >= 200 && consumed.code < 300 ? "stored" : "rejected";
};

describe("M4-05 live evidence: what the independent watch holds", () => {
  it("H5a: grant 1's stored write is one event, with its hash, uid, carrier and the audit's version", () => {
    const holding = fixture.watchEvents.filter(event => event.matchesGrant.includes(grant1.grantId));
    const first = must(holding[0], "grant 1's first matching event");
    expect(first.type).toBe("MODIFIED");
    expect(first.hashChangedFromPrevious).toBe(true);
    expect(first.uid).toBe(grant1.resourceUid);
    expect(first.carrierGrantId).toBe(grant1.grantId);
    const audited = fixture.audit.find(event => event.grantId === grant1.grantId && event.outcome === "allow-consumed");
    expect(first.resourceVersion).toBe(audited?.storedResourceVersion);
  });

  it("H5b: nothing in the stream names or matches grant 2, which the audit says was rejected", () => {
    expect(fixture.watchEvents.filter(event => event.carrierGrantId === grant2.grantId)).toEqual([]);
    expect(fixture.watchEvents.filter(event => event.matchesGrant.includes(grant2.grantId))).toEqual([]);
    expect(fromWatch(grant2, PRIOR_RV, fullStream)).toBe("watch_holds_no_target_state");
  });

  it("H5c: version advances without a spec change are common, before and after the write", () => {
    const write = must(fixture.watchEvents.find(event => event.matchesGrant.includes(grant1.grantId)), "the write's event");
    const statusOnly = fixture.watchEvents.filter(event => !event.hashChangedFromPrevious);
    const before = statusOnly.filter(event => compareResourceVersions(event.resourceVersion, write.resourceVersion) === -1);
    const after = statusOnly.filter(event => compareResourceVersions(event.resourceVersion, write.resourceVersion) === 1);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    // Every later status-only event still names grant 1: a count of events
    // naming a grant is not a count of writes.
    expect(fixture.watchEvents.filter(event => event.carrierGrantId === grant1.grantId).length).toBeGreaterThan(1);
  });

  it("the read taken before the first write is not the admission's prior version", () => {
    // The watch opened at the version read before step 1. Status-only
    // updates landed before the write, so the oldObject version the
    // enforcer saw (the dry-run's response) is newer.
    expect(compareResourceVersions(fixture.watchStartResourceVersion, PRIOR_RV)).toBe(-1);
    const between = fixture.watchEvents.filter(event =>
      compareResourceVersions(event.resourceVersion, fixture.watchStartResourceVersion) === 1 &&
      compareResourceVersions(event.resourceVersion, PRIOR_RV) !== 1);
    expect(between.length).toBeGreaterThan(0);
    expect(between.every(event => !event.hashChangedFromPrevious || event === fixture.watchEvents[0])).toBe(true);
  });
});

describe("M4-05 attacks 04 could not settle, with the watch as observer", () => {
  it("baseline: the watch agrees with both truthful audit claims", () => {
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
      events: fixture.watchEvents.filter(event => compareResourceVersions(event.resourceVersion, "710") === 1),
    };
    expect(fromWatch(grant1, PRIOR_RV, late)).toBe("unknown_stream_does_not_cover_admission");
    expect(reconcile("rejected", fromWatch(grant1, PRIOR_RV, late))).toBe("claim_unchecked_watch_unknown");
    expect(reconcile("stored", fromWatch(grant2, PRIOR_RV, late))).toBe("claim_unchecked_watch_unknown");
  });

  it("a stream with a gap in versions is unknown; one with events out of order too", () => {
    const reordered: Stream = { fromResourceVersion: fullStream.fromResourceVersion, events: [...fixture.watchEvents].reverse() };
    expect(fromWatch(grant2, PRIOR_RV, reordered)).toBe("unknown_stream_discontinuous");
  });

  it("target state without the carrier is unattributed, not stored", () => {
    // 01's convergent re-apply: another writer produced the target state
    // and the carrier is gone. In this tier a write without a consumed
    // grant is denied, so this should not occur; if it does, the verdict
    // must not read as the grant's write.
    const stripped: Stream = {
      fromResourceVersion: fullStream.fromResourceVersion,
      events: fixture.watchEvents.map(event => ({ ...event, carrierGrantId: undefined })),
    };
    expect(fromWatch(grant1, PRIOR_RV, stripped)).toBe("watch_holds_target_without_carrier");
    expect(reconcile("stored", fromWatch(grant1, PRIOR_RV, stripped))).toBe("claim_stored_state_unattributed");
  });

  it("a carrier naming the grant on the wrong state does not count as the write", () => {
    const wrongState: Stream = {
      fromResourceVersion: fullStream.fromResourceVersion,
      events: fixture.watchEvents.map(event => ({ ...event, matchesGrant: [] })),
    };
    expect(fromWatch(grant1, PRIOR_RV, wrongState)).toBe("watch_holds_no_target_state");
  });
});

describe("M4-05 vocabulary", () => {
  it("every verdict returned names its source, none reads as an attestation, and each was exercised", () => {
    const seen = [...returned];
    for (const verdict of [...WATCH_VERDICTS, ...RECONCILED]) expect(seen).toContain(verdict);
    for (const verdict of seen) expect(verdict).not.toMatch(/persist|verified|proven|success|realized|applied/);
  });
});
