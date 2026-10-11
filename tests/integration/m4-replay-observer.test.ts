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
  /** The object's uid. Absent in an artifact that predates the field; see joinUid below. */
  uid: z.string().nullable().optional(),
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
    type: z.string(), resourceVersion: z.string().optional(), objectHash: z.string().optional(), uid: z.string().optional(),
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
/**
 * The committed artifact's replay rows predate the uid field. The same run's
 * live watch recorded the uid of every Deployment event, and a replay row
 * and a live event with the same resourceVersion are the same stored
 * version of the same object, so the uid is joined from it. Artifacts
 * produced by the current summary script carry the uid on the row itself.
 */
const uidByVersion = new Map(
  watchEvidence.watchEvents.filter(event => event.uid !== undefined && event.resourceVersion !== undefined)
    .map(event => [event.resourceVersion as string, event.uid as string]),
);
const request = (name: string) => {
  const found = must(replayEvidence.results.find(item => item.name === name), `the ${name} request`);
  const rows = (found.rows ?? []).map(row => ({
    ...row,
    uid: row.uid ?? (row.resourceVersion !== undefined ? uidByVersion.get(row.resourceVersion) ?? null : null),
  }));
  return { rows, other: found.other ?? [] };
};
const grant1 = must(watchEvidence.grants[0], "grant 1");
const grant2 = must(watchEvidence.grants[1], "grant 2");
const versionsOf = (rows: ReplayRow[]) => rows.map(row => row.resourceVersion);
/**
 * The version each grant's admission saw. Grant 1's is its own dry-run's
 * response (the enforcer does not record oldObject today, P3). Grant 2 has
 * no dry-run in the artifact; it was admitted after grant 1's write was
 * stored, so the version of that write is a LOWER BOUND of its prior. A
 * lower bound is safe for the coverage check and for absence; it is not
 * safe for presence in general (an earlier window can hold another
 * writer's event), which the carrier requirement below is what guards.
 */
const priorVersion = must(replayEvidence.dryRunVersion ?? undefined, "the dry-run's version");
const grant2PriorBound = must(
  liveWatch.find(event => (event.matchesGrant ?? []).includes(grant1.grantId))?.resourceVersion,
  "grant 1's stored version");
const priorOf = (grantId: string) => (grantId === grant1.grantId ? priorVersion : grant2PriorBound);

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
  /** The version the enforcer saw at this grant's admission (or a lower bound of it). */
  admissionVersion: string;
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
function fromReplay(grant: { grantId: string; resourceUid: string }, input: ReplayInput): ReplayVerdict {
  const priorVersion = input.admissionVersion;
  if (input.other.length > 0 || input.rows.some(row => row.status !== undefined && row.status !== null)) {
    return "unknown_history_unavailable";
  }
  if (input.requestedVersion === "0") return "unknown_replay_not_from_admission";
  const starts = compareResourceVersions(input.requestedVersion, priorVersion);
  if (starts === undefined || starts === 1) return "unknown_replay_not_from_admission";

  const events = input.rows.filter(row => row.resourceVersion !== undefined && row.objectHash !== undefined);
  const holding = events.find(row =>
    row.type !== "DELETED" &&
    // The hash excludes identity: a recreated object in the same state matches
    // by hash, so the incarnation the grant was issued for must be checked.
    row.uid === grant.resourceUid &&
    (row.matchesGrant ?? []).includes(grant.grantId) &&
    compareResourceVersions(row.resourceVersion ?? "", priorVersion) === 1);
  if (holding !== undefined) {
    return holding.carrierGrantId === grant.grantId ? "replay_holds_target_with_carrier" : "replay_holds_target_without_carrier";
  }
  const last = events[events.length - 1];
  const reachesNow = input.closingVersion !== undefined && last !== undefined && last.resourceVersion === input.closingVersion;
  return reachesNow ? "replay_holds_no_target_state" : "unknown_replay_incomplete";
}

const replayInput = (grantId: string, name: string, requestedVersion: string): ReplayInput => ({
  admissionVersion: priorOf(grantId), requestedVersion, rows: request(name).rows, other: request(name).other, closingVersion: closingObjectVersion,
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

  it("each replay is exactly the retained history strictly newer than the version it asked for", () => {
    // Derived from the ancient request (version 1), which returned
    // everything retained, so this holds whether or not the two requested
    // versions coincided in a run.
    const history = request("ancient").rows;
    const newerThan = (version: string) => history
      .filter(row => compareResourceVersions(must(row.resourceVersion, "a version"), version) === 1)
      .map(row => row.resourceVersion);
    expect(versionsOf(request("replay").rows)).toEqual(newerThan(replayEvidence.readBeforeStep1));
    expect(versionsOf(request("replay-prior").rows)).toEqual(newerThan(must(replayEvidence.dryRunVersion ?? undefined, "the dry-run version")));
  });
});

describe("M4-06 what an observer concludes from the replay", () => {
  it("a replay from the admission's version, reaching the object's current version, settles both grants", () => {
    expect(fromReplay(grant1, replayInput(grant1.grantId, "replay-prior", priorVersion))).toBe("replay_holds_target_with_carrier");
    expect(fromReplay(grant2, replayInput(grant2.grantId, "replay-prior", priorVersion))).toBe("replay_holds_no_target_state");
  });

  it("version 0 is never a replay, even when it happens to show the current state", () => {
    expect(fromReplay(grant2, replayInput(grant2.grantId, "any", "0"))).toBe("unknown_replay_not_from_admission");
  });

  it("a replay that stops short of the object's current version is unknown for absence", () => {
    const rows = request("replay-prior").rows;
    expect(fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows: rows.slice(0, 2), other: [], closingVersion: closingObjectVersion }))
      .toBe("unknown_replay_incomplete");
    expect(fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows, other: [], closingVersion: undefined }))
      .toBe("unknown_replay_incomplete");
  });

  it("an error status, or kubectl's error text, means the history is unavailable, never empty", () => {
    const failed = { type: "ERROR", status: { code: 410, reason: "Expired" } };
    expect(fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows: [failed], other: [], closingVersion: closingObjectVersion }))
      .toBe("unknown_history_unavailable");
    expect(fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows: [], other: ["Error from server (Expired): too old resource version: 1"], closingVersion: closingObjectVersion }))
      .toBe("unknown_history_unavailable");
  });

  it("a replay requested after the admission does not cover it", () => {
    expect(fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: "999999", rows: [], other: [], closingVersion: closingObjectVersion }))
      .toBe("unknown_replay_not_from_admission");
  });

  it("target state without this grant's carrier is not attributed to it, and a DELETED event is not a write", () => {
    const rows = request("replay-prior").rows;
    const stripped = rows.map(row => ({ ...row, carrierGrantId: undefined }));
    expect(fromReplay(grant1, { admissionVersion: priorOf(grant1.grantId), requestedVersion: priorVersion, rows: stripped, other: [], closingVersion: closingObjectVersion }))
      .toBe("replay_holds_target_without_carrier");
    const deleted = rows.map(row => ({ ...row, type: "DELETED" }));
    expect(fromReplay(grant1, { admissionVersion: priorOf(grant1.grantId), requestedVersion: priorVersion, rows: deleted, other: [], closingVersion: closingObjectVersion }))
      .toBe("replay_holds_no_target_state");
  });

  it("a replacement object in the same state, with the carrier, is not the incarnation the grant was issued for", () => {
    // Review finding: the object hash excludes server-assigned identity, so a
    // Deployment deleted and recreated under the same name matches by hash.
    const rows = request("replay-prior").rows;
    const replacement = rows.map(row => ({ ...row, uid: "00000000-0000-0000-0000-00000000dead" }));
    const verdict = fromReplay(grant1, { admissionVersion: priorOf(grant1.grantId), requestedVersion: priorVersion, rows: replacement, other: [], closingVersion: closingObjectVersion });
    expect(verdict).not.toBe("replay_holds_target_with_carrier");
    expect(verdict).toBe("replay_holds_no_target_state");
  });

  it("every replay row of the committed run carries the grant's incarnation, joined from the live watch", () => {
    const rows = request("replay-prior").rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.uid === must(watchEvidence.grants[0], "grant 1").resourceUid)).toBe(true);
  });

  it("a row without a version is skipped, not a crash", () => {
    const bookmark = { type: "BOOKMARK" };
    const rows = [...request("replay-prior").rows, bookmark];
    expect(fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows, other: [], closingVersion: closingObjectVersion }))
      .toBe("replay_holds_no_target_state");
  });

  it("every verdict is reachable from a fixed table, and none reads as an attestation", () => {
    const rows = request("replay-prior").rows;
    const table: Array<[ReplayVerdict, ReplayVerdict]> = [
      ["replay_holds_target_with_carrier", fromReplay(grant1, replayInput(grant1.grantId, "replay-prior", priorVersion))],
      ["replay_holds_target_without_carrier", fromReplay(grant1, { admissionVersion: priorOf(grant1.grantId), requestedVersion: priorVersion, rows: rows.map(row => ({ ...row, carrierGrantId: undefined })), other: [], closingVersion: closingObjectVersion })],
      ["replay_holds_no_target_state", fromReplay(grant2, replayInput(grant2.grantId, "replay-prior", priorVersion))],
      ["unknown_replay_not_from_admission", fromReplay(grant2, replayInput(grant2.grantId, "any", "0"))],
      ["unknown_replay_incomplete", fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows: rows.slice(0, 1), other: [], closingVersion: closingObjectVersion })],
      ["unknown_history_unavailable", fromReplay(grant2, { admissionVersion: priorOf(grant2.grantId), requestedVersion: priorVersion, rows: [], other: ["Error from server"], closingVersion: closingObjectVersion })],
    ];
    expect(table.map(([expected]) => expected).sort()).toEqual([...REPLAY_VERDICTS].sort());
    for (const [expected, actual] of table) {
      expect(actual).toBe(expected);
      expect(actual).not.toMatch(/persist|verified|proven|success|realized|applied/);
    }
  });
});

describe("M4-06 the live harness", () => {
  it("fails the reproduction when the admission's prior version cannot be recovered", () => {
    const script = readFileSync(path.resolve("examples/m2-kubernetes-enforcer/kind-repro.sh"), "utf8");
    const lookup = script.indexOf('M4_PRIOR_RV=$(node "${EXAMPLE_DIR}/m4-prior-version.mjs"');
    const guard = script.indexOf('if [ -z "${M4_PRIOR_RV}" ]; then', lookup);
    const replay = script.indexOf('m4_replay replay-prior "${M4_PRIOR_RV}"', lookup);
    expect(lookup).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(lookup);
    // The guard exits before the replay it protects, and the replay is not conditional.
    expect(script.slice(guard, replay)).toContain("exit 1");
    expect(script.slice(guard - 0, replay)).not.toMatch(/\n\s*if \[ -n "\$\{M4_PRIOR_RV\}" \]/);
  });
});
