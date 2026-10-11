import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compareResourceVersions } from "./resource-version";

/**
 * M4 experiment 06 (docs/M4_EXPERIMENT_06.md), replayed offline against the
 * requests the live kind run made after the M4 steps. The raw artifacts of
 * that run are committed byte for byte, and this file checks each against
 * the SHA-256 in the manifest before using it. Nothing here talks to a
 * cluster; the contract is test-local, per docs/M4_DECISION.md.
 */

const dir = path.resolve("examples/m2-kubernetes-enforcer/evidence/2026-10-11-run-b");
const Manifest = z.object({ ciRun: z.string().url(), files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)) });
const manifest = Manifest.parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
function verified(name: string): unknown {
  const bytes = readFileSync(path.join(dir, name));
  const declared = manifest.files[name];
  if (createHash("sha256").update(bytes).digest("hex") !== declared) throw new Error(`${name} does not match its manifest hash`);
  return JSON.parse(bytes.toString("utf8"));
}

const Row = z.object({
  type: z.string(),
  resourceVersion: z.string().optional(),
  objectHash: z.string().optional(),
  carrierGrantId: z.string().optional(),
  matchesGrant: z.array(z.string()).optional(),
  status: z.unknown().optional(),
});
type ReplayRow = z.infer<typeof Row>;
const ReplayEvidence = z.object({
  readBeforeStep1: z.string(),
  dryRunVersion: z.string().nullable(),
  grants: z.array(z.object({ grantId: z.string(), objectSha256: z.string() })),
  results: z.array(z.object({ name: z.string(), rows: z.array(Row).optional(), other: z.array(z.string()).optional() })),
});
const WatchEvidence = z.object({
  grants: z.array(z.object({ grantId: z.string(), objectSha256: z.string(), resourceUid: z.string() })),
  useState: z.array(z.object({ grant_id: z.string(), admission_uid: z.string() })),
  watchEvents: z.array(z.object({
    type: z.string(), resourceVersion: z.string().optional(), objectHash: z.string().optional(),
    carrierGrantId: z.string().optional(), matchesGrant: z.array(z.string()).optional(),
  })),
});
const replayEvidence = ReplayEvidence.parse(verified("m4-replay-evidence.json"));
const watchEvidence = WatchEvidence.parse(verified("m4-watch-evidence.json"));
const liveWatch = watchEvidence.watchEvents.filter(event => event.objectHash !== undefined);

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`fixture is missing ${what}`);
  return value;
};
const request = (name: string) => {
  const found = must(replayEvidence.results.find(item => item.name === name), `the ${name} request`);
  return { rows: found.rows ?? [], other: found.other ?? [] };
};
const grant1 = must(watchEvidence.grants[0], "grant 1");
const grant2 = must(watchEvidence.grants[1], "grant 2");
const versionsOf = (rows: ReplayRow[]) => rows.map(row => row.resourceVersion);
const priorVersion = must(replayEvidence.dryRunVersion ?? undefined, "the dry-run's version");

/** The object's version in a read taken after the replay: the list item carries it. */
const closingObjectVersion = must(
  request("list").rows.find(row => row.type === "LIST-ITEM")?.resourceVersion, "the list item's version");

const REPLAY_VERDICTS = [
  "replay_holds_target_with_carrier",
  "replay_holds_target_without_carrier",
  "replay_holds_no_target_state",
  "unknown_replay_not_from_admission",
  "unknown_replay_incomplete",
  "unknown_history_unavailable",
] as const;
type ReplayVerdict = (typeof REPLAY_VERDICTS)[number];

interface ReplayInput {
  requestedVersion: string;
  rows: ReplayRow[];
  /** Lines the request produced that were not events: kubectl's own error text lands here. */
  other: string[];
  closingVersion: string | undefined;
}

/**
 * What a replay says about one grant's write. A replay is a watch started
 * at a requested version, which the API server answers with every event it
 * holds that is strictly newer. It covers the admission when it was asked
 * for at or before the prior version. Presence needs the event to be a
 * write (not DELETED), to hash to the grant's target, and to carry this
 * grant's id. Absence is only evidence when the replay's last event
 * carries the object's version in a read taken after it. Version 0 is
 * "any": the current state with no history, never a replay. Anything that
 * is not an event (an ERROR status, kubectl's error text) means the
 * history is unavailable, never an empty history.
 */
function fromReplay(grant: { grantId: string }, input: ReplayInput): ReplayVerdict {
  if (input.other.length > 0 || input.rows.some(row => row.status !== undefined && row.status !== null)) {
    return "unknown_history_unavailable";
  }
  if (input.requestedVersion === "0") return "unknown_replay_not_from_admission";
  const starts = compareResourceVersions(input.requestedVersion, priorVersion);
  if (starts === undefined || starts === 1) return "unknown_replay_not_from_admission";

  const events = input.rows.filter(row => row.resourceVersion !== undefined && row.objectHash !== undefined);
  const holding = events.find(row =>
    row.type !== "DELETED" &&
    (row.matchesGrant ?? []).includes(grant.grantId) &&
    compareResourceVersions(row.resourceVersion ?? "", priorVersion) === 1);
  if (holding !== undefined) {
    return holding.carrierGrantId === grant.grantId ? "replay_holds_target_with_carrier" : "replay_holds_target_without_carrier";
  }
  const last = events[events.length - 1];
  const reachesNow = input.closingVersion !== undefined && last !== undefined && last.resourceVersion === input.closingVersion;
  return reachesNow ? "replay_holds_no_target_state" : "unknown_replay_incomplete";
}

const replayInput = (name: string, requestedVersion: string): ReplayInput => ({
  requestedVersion, rows: request(name).rows, other: request(name).other, closingVersion: closingObjectVersion,
});

describe("M4-06 live evidence: what the API server answered", () => {
  it("the committed artifacts are the run's, byte for byte (checked by hash before use)", () => {
    expect(Object.keys(manifest.files).sort()).toEqual(["m4-replay-evidence.json", "m4-watch-evidence.json"]);
  });

  it("H6a: replay from the admission's version delivers the live watch's events, the same versions and hashes", () => {
    const replay = request("replay-prior");
    expect(versionsOf(replay.rows)).toEqual(liveWatch.map(event => event.resourceVersion));
    expect(replay.rows.map(row => row.objectHash)).toEqual(liveWatch.map(event => event.objectHash));
    expect(replay.rows.map(row => row.carrierGrantId)).toEqual(liveWatch.map(event => event.carrierGrantId));
  });

  it("H6b (refuted): version 1 is not answered with 410; it delivers the whole retained history", () => {
    const ancient = request("ancient");
    expect(ancient.rows.some(row => row.status !== undefined)).toBe(false);
    expect(ancient.other).toEqual([]);
    expect(ancient.rows[0]?.type).toBe("ADDED");
    const firstReplayVersion = must(request("replay").rows[0]?.resourceVersion, "the first replay version");
    const older = ancient.rows.filter(row => compareResourceVersions(must(row.resourceVersion, "a version"), firstReplayVersion) === -1);
    expect(older.length).toBeGreaterThan(1);
  });

  it("H6c: version 0 is the current state with no history", () => {
    const any = request("any");
    expect(any.rows).toHaveLength(1);
    expect(any.rows[0]?.type).toBe("ADDED");
    expect(any.rows[0]?.resourceVersion).toBe(must(liveWatch[liveWatch.length - 1], "the last live event").resourceVersion);
  });

  it("H6d: no replayed event names or matches grant 2", () => {
    for (const name of ["replay", "replay-prior", "ancient"]) {
      const rows = request(name).rows;
      expect(rows.filter(row => row.carrierGrantId === grant2.grantId)).toEqual([]);
      expect(rows.filter(row => (row.matchesGrant ?? []).includes(grant2.grantId))).toEqual([]);
    }
  });

  it("H6e: a NotOlderThan list returns the current object and a collection version that is not the object's", () => {
    const list = request("list");
    const item = must(list.rows.find(row => row.type === "LIST-ITEM"), "the list item");
    const meta = must(list.rows.find(row => row.type === "LIST-META"), "the list metadata");
    expect(item.resourceVersion).toBe(closingObjectVersion);
    expect(compareResourceVersions(must(meta.resourceVersion, "list version"), closingObjectVersion)).toBe(1);
  });

  it("H6f: a replay delivers only events strictly newer than the requested version", () => {
    expect(versionsOf(request("replay-prior").rows)).not.toContain(replayEvidence.dryRunVersion);
    expect(versionsOf(request("ancient").rows)).toContain(replayEvidence.dryRunVersion);
  });

  it("the two replays agree exactly when their requested versions are equal", () => {
    // In the experiment 05 run the read before step 1 and the dry-run's
    // version differed; whether they do is a property of the run, not a
    // contract, so this asserts the relation and not the coincidence.
    const sameVersion = replayEvidence.readBeforeStep1 === replayEvidence.dryRunVersion;
    const sameRows = JSON.stringify(versionsOf(request("replay").rows)) === JSON.stringify(versionsOf(request("replay-prior").rows));
    if (sameVersion) expect(sameRows).toBe(true);
  });
});

describe("M4-06 what an observer concludes from the replay", () => {
  it("a replay from the admission's version, reaching the object's current version, settles both grants", () => {
    expect(fromReplay(grant1, replayInput("replay-prior", priorVersion))).toBe("replay_holds_target_with_carrier");
    expect(fromReplay(grant2, replayInput("replay-prior", priorVersion))).toBe("replay_holds_no_target_state");
  });

  it("version 0 is never a replay, even when it happens to show the current state", () => {
    expect(fromReplay(grant2, replayInput("any", "0"))).toBe("unknown_replay_not_from_admission");
  });

  it("a replay that stops short of the object's current version is unknown for absence", () => {
    const rows = request("replay-prior").rows;
    expect(fromReplay(grant2, { requestedVersion: priorVersion, rows: rows.slice(0, 2), other: [], closingVersion: closingObjectVersion }))
      .toBe("unknown_replay_incomplete");
    expect(fromReplay(grant2, { requestedVersion: priorVersion, rows, other: [], closingVersion: undefined }))
      .toBe("unknown_replay_incomplete");
  });

  it("an error status, or kubectl's error text, means the history is unavailable, never empty", () => {
    const failed = { type: "ERROR", status: { code: 410, reason: "Expired" } };
    expect(fromReplay(grant2, { requestedVersion: priorVersion, rows: [failed], other: [], closingVersion: closingObjectVersion }))
      .toBe("unknown_history_unavailable");
    expect(fromReplay(grant2, { requestedVersion: priorVersion, rows: [], other: ["Error from server (Expired): too old resource version: 1"], closingVersion: closingObjectVersion }))
      .toBe("unknown_history_unavailable");
  });

  it("a replay requested after the admission does not cover it", () => {
    expect(fromReplay(grant2, { requestedVersion: "999999", rows: [], other: [], closingVersion: closingObjectVersion }))
      .toBe("unknown_replay_not_from_admission");
  });

  it("target state without this grant's carrier is not attributed to it, and a DELETED event is not a write", () => {
    const rows = request("replay-prior").rows;
    const stripped = rows.map(row => ({ ...row, carrierGrantId: undefined }));
    expect(fromReplay(grant1, { requestedVersion: priorVersion, rows: stripped, other: [], closingVersion: closingObjectVersion }))
      .toBe("replay_holds_target_without_carrier");
    const deleted = rows.map(row => ({ ...row, type: "DELETED" }));
    expect(fromReplay(grant1, { requestedVersion: priorVersion, rows: deleted, other: [], closingVersion: closingObjectVersion }))
      .toBe("replay_holds_no_target_state");
  });

  it("a row without a version is skipped, not a crash", () => {
    const bookmark = { type: "BOOKMARK" };
    const rows = [...request("replay-prior").rows, bookmark];
    expect(fromReplay(grant2, { requestedVersion: priorVersion, rows, other: [], closingVersion: closingObjectVersion }))
      .toBe("replay_holds_no_target_state");
  });

  it("every verdict is reachable from a fixed table, and none reads as an attestation", () => {
    const rows = request("replay-prior").rows;
    const table: Array<[ReplayVerdict, ReplayVerdict]> = [
      ["replay_holds_target_with_carrier", fromReplay(grant1, replayInput("replay-prior", priorVersion))],
      ["replay_holds_target_without_carrier", fromReplay(grant1, { requestedVersion: priorVersion, rows: rows.map(row => ({ ...row, carrierGrantId: undefined })), other: [], closingVersion: closingObjectVersion })],
      ["replay_holds_no_target_state", fromReplay(grant2, replayInput("replay-prior", priorVersion))],
      ["unknown_replay_not_from_admission", fromReplay(grant2, replayInput("any", "0"))],
      ["unknown_replay_incomplete", fromReplay(grant2, { requestedVersion: priorVersion, rows: rows.slice(0, 1), other: [], closingVersion: closingObjectVersion })],
      ["unknown_history_unavailable", fromReplay(grant2, { requestedVersion: priorVersion, rows: [], other: ["Error from server"], closingVersion: closingObjectVersion })],
    ];
    expect(table.map(([expected]) => expected).sort()).toEqual([...REPLAY_VERDICTS].sort());
    for (const [expected, actual] of table) {
      expect(actual).toBe(expected);
      expect(actual).not.toMatch(/persist|verified|proven|success|realized|applied/);
    }
  });
});
