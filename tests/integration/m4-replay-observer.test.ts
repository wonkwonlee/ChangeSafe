import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compareResourceVersions } from "./resource-version";

/**
 * M4 experiment 06 (docs/M4_EXPERIMENT_06.md), replayed offline against the
 * requests the live kind run made after the M4 steps. Nothing here talks to
 * a cluster; the contract is test-local, per docs/M4_DECISION.md.
 */

const Row = z.object({
  type: z.string(),
  resourceVersion: z.string().nullable(),
  objectHash: z.string().nullable(),
  carrierGrantId: z.string().nullable(),
  matchesGrant: z.array(z.string()),
  status: z.unknown().nullable(),
});
const Fixture = z.object({
  source: z.object({ ciRun: z.string().url(), replayArtifactSha256: z.string(), watchArtifactSha256: z.string() }).passthrough(),
  readBeforeStep1: z.string(),
  dryRunVersion: z.string().nullable(),
  grants: z.array(z.object({ grantId: z.string(), objectSha256: z.string(), resourceUid: z.string() })),
  useState: z.array(z.object({ grant_id: z.string(), admission_uid: z.string() })),
  liveWatch: z.array(z.object({
    type: z.string(), resourceVersion: z.string(), objectHash: z.string(),
    carrierGrantId: z.string().nullable(), matchesGrant: z.array(z.string()),
  })),
  requests: z.array(z.object({ name: z.string(), rows: z.array(Row), other: z.array(z.string()) })),
});
const fixture = Fixture.parse(JSON.parse(readFileSync(
  path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-m4-replay.json"), "utf8")));

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`fixture is missing ${what}`);
  return value;
};
const request = (name: string) => must(fixture.requests.find(item => item.name === name), `the ${name} request`);
const grant1 = must(fixture.grants[0], "grant 1");
const grant2 = must(fixture.grants[1], "grant 2");
const versionsOf = (rows: Array<{ resourceVersion: string | null }>) => rows.map(row => row.resourceVersion);
const priorVersion = must(fixture.dryRunVersion ?? undefined, "the dry-run's version");

/** The object's version in a read taken after the replay: the list item carries it. */
const closingObjectVersion = must(
  request("list").rows.find(row => row.type === "LIST-ITEM")?.resourceVersion ?? undefined, "the list item's version");

type ReplayVerdict =
  | "replay_holds_target_with_carrier"
  | "replay_holds_no_target_state"
  | "unknown_replay_not_from_admission"
  | "unknown_replay_incomplete"
  | "unknown_history_unavailable";

/**
 * What a replay says about one grant's write. A replay is a watch started
 * at a requested version, which the API server answers with every event it
 * holds that is strictly newer. It covers the admission when it was asked
 * for at or before the prior version. Absence is only evidence when the
 * replay's last event carries the object's version in a read taken after
 * it (nothing newer was missed). Version 0 is "any": it delivers the
 * current state with no history and is never a replay.
 */
function fromReplay(
  grant: { grantId: string; objectSha256: string },
  requestedVersion: string,
  rows: Array<z.infer<typeof Row>>,
  closingVersion: string | undefined,
): ReplayVerdict {
  if (rows.some(row => row.status !== null)) return "unknown_history_unavailable";
  if (requestedVersion === "0") return "unknown_replay_not_from_admission";
  const starts = compareResourceVersions(requestedVersion, priorVersion);
  if (starts === undefined || starts === 1) return "unknown_replay_not_from_admission";
  const holding = rows.find(row => row.matchesGrant.includes(grant.grantId) && compareResourceVersions(must(row.resourceVersion ?? undefined, "a version"), priorVersion) === 1);
  if (holding !== undefined) return "replay_holds_target_with_carrier";
  const last = rows[rows.length - 1];
  const reachesNow = closingVersion !== undefined && last !== undefined && last.resourceVersion === closingVersion;
  return reachesNow ? "replay_holds_no_target_state" : "unknown_replay_incomplete";
}

describe("M4-06 live evidence: what the API server answered", () => {
  it("H6a: replay from the admission's version delivers the live watch's events, the same versions and hashes", () => {
    const replay = request("replay-prior");
    expect(versionsOf(replay.rows)).toEqual(fixture.liveWatch.map(event => event.resourceVersion));
    expect(replay.rows.map(row => row.objectHash)).toEqual(fixture.liveWatch.map(event => event.objectHash));
    expect(replay.rows.map(row => row.carrierGrantId)).toEqual(fixture.liveWatch.map(event => event.carrierGrantId));
  });

  it("H6b (refuted): version 1 is not answered with 410; it delivers the whole retained history", () => {
    const ancient = request("ancient");
    expect(ancient.rows.some(row => row.status !== null)).toBe(false);
    expect(ancient.other).toEqual([]);
    expect(ancient.rows[0]?.type).toBe("ADDED");
    // Everything before the replay's first event: the object's creation and
    // the updates before the grant's write.
    const older = ancient.rows.filter(row => compareResourceVersions(must(row.resourceVersion ?? undefined, "a version"), must(request("replay").rows[0]?.resourceVersion ?? undefined, "the first replay version")) === -1);
    expect(older.length).toBeGreaterThan(1);
  });

  it("H6c: version 0 is the current state with no history", () => {
    const any = request("any");
    expect(any.rows).toHaveLength(1);
    expect(any.rows[0]?.type).toBe("ADDED");
    expect(any.rows[0]?.resourceVersion).toBe(must(fixture.liveWatch[fixture.liveWatch.length - 1], "the last live event").resourceVersion);
  });

  it("H6d: no replayed event names or matches grant 2", () => {
    for (const name of ["replay", "replay-prior", "ancient"]) {
      const rows = request(name).rows;
      expect(rows.filter(row => row.carrierGrantId === grant2.grantId)).toEqual([]);
      expect(rows.filter(row => row.matchesGrant.includes(grant2.grantId))).toEqual([]);
    }
  });

  it("H6e: a NotOlderThan list returns the current object and a collection version that is not the object's", () => {
    const list = request("list");
    const item = must(list.rows.find(row => row.type === "LIST-ITEM"), "the list item");
    const meta = must(list.rows.find(row => row.type === "LIST-META"), "the list metadata");
    expect(item.resourceVersion).toBe(closingObjectVersion);
    expect(compareResourceVersions(must(meta.resourceVersion ?? undefined, "list version"), closingObjectVersion)).toBe(1);
  });

  it("H6f: a replay delivers only events strictly newer than the requested version", () => {
    const replay = request("replay-prior");
    expect(versionsOf(replay.rows)).not.toContain(fixture.dryRunVersion);
    expect(versionsOf(request("ancient").rows)).toContain(fixture.dryRunVersion);
  });

  it("the read before step 1 equalled the dry-run's version in this run, so the two replays are identical", () => {
    // In the experiment 05 run they differed (616 against 684); here they
    // did not. The earlier read is not a reliable stand-in either way.
    expect(fixture.readBeforeStep1).toBe(fixture.dryRunVersion);
    expect(versionsOf(request("replay").rows)).toEqual(versionsOf(request("replay-prior").rows));
  });
});

describe("M4-06 what an observer concludes from the replay", () => {
  const replay = () => request("replay-prior").rows;

  it("a replay from the admission's version, reaching the object's current version, settles both grants", () => {
    expect(fromReplay(grant1, priorVersion, replay(), closingObjectVersion)).toBe("replay_holds_target_with_carrier");
    expect(fromReplay(grant2, priorVersion, replay(), closingObjectVersion)).toBe("replay_holds_no_target_state");
  });

  it("version 0 is never a replay, even when it happens to show the current state", () => {
    expect(fromReplay(grant2, "0", request("any").rows, closingObjectVersion)).toBe("unknown_replay_not_from_admission");
  });

  it("a replay that stops short of the object's current version is unknown for absence", () => {
    const stoppedEarly = replay().slice(0, 2);
    expect(fromReplay(grant2, priorVersion, stoppedEarly, closingObjectVersion)).toBe("unknown_replay_incomplete");
    expect(fromReplay(grant2, priorVersion, replay(), undefined)).toBe("unknown_replay_incomplete");
  });

  it("an error or status event means the history is unavailable, never an empty history", () => {
    const failed = [{ type: "ERROR", resourceVersion: null, objectHash: null, carrierGrantId: null, matchesGrant: [], status: { code: 410, reason: "Expired" } }];
    expect(fromReplay(grant2, priorVersion, failed, closingObjectVersion)).toBe("unknown_history_unavailable");
  });

  it("a replay requested after the admission does not cover it", () => {
    expect(fromReplay(grant2, "9999", [], closingObjectVersion)).toBe("unknown_replay_not_from_admission");
  });

  it("no verdict reads as an attestation of effect or authorship", () => {
    const verdicts: ReplayVerdict[] = [
      fromReplay(grant1, priorVersion, replay(), closingObjectVersion),
      fromReplay(grant2, priorVersion, replay(), closingObjectVersion),
      fromReplay(grant2, "0", request("any").rows, closingObjectVersion),
      fromReplay(grant2, priorVersion, replay().slice(0, 1), closingObjectVersion),
      fromReplay(grant2, priorVersion, [{ type: "ERROR", resourceVersion: null, objectHash: null, carrierGrantId: null, matchesGrant: [], status: { code: 410 } }], closingObjectVersion),
    ];
    expect(new Set(verdicts).size).toBe(5);
    for (const verdict of verdicts) expect(verdict).not.toMatch(/persist|verified|proven|success|realized|applied/);
  });
});
