import { describe, expect, it } from "vitest";

/**
 * M4 experiment 07 (docs/M4_EXPERIMENT_07.md): a bounded exhaustive check of
 * an observation contract. A model of the evidence, not of Kubernetes: its
 * histories are hand-written from what experiments 03 to 06 observed, every
 * combination of the dimensions below is enumerated, and each contract is
 * scored for soundness (a definite verdict that disagrees with what
 * happened) and for how often it must say unknown.
 *
 * Hash equality and signatures are abstract, as in M3. "No unsound verdict
 * found" means no counterexample in this model, never proven sound.
 */

// --- The world ---------------------------------------------------------------

type State = "P" | "T";
type Carrier = null | "G" | "G2" | "G3" | "G4" | "G5";
interface Ev {
  rv: number;
  type: "ADDED" | "MODIFIED" | "DELETED";
  uid: "U1" | "U2";
  state: State;
  carrier: Carrier;
}

type Attempt = "stored" | "rejected_downstream" | "not_attempted";
type Later = "none" | "restores_prior" | "via_other_grant" | "sets_target_no_carrier" | "sets_target_copied_carrier";
type Tier = "protected" | "default";

interface History {
  attempt: Attempt;
  /** The grant's target state equals the state it was issued against. */
  noOp: boolean;
  statusBefore: boolean;
  statusAfter: boolean;
  /** Another grant stored the target, then another restored the prior, before this grant's admission. */
  otherGrantBefore: boolean;
  later: Later;
  recreated: boolean;
  tier: Tier;
}

const WATCH_START = 100;

interface World {
  events: Ev[];
  /** The version the enforcer saw at G's admission. */
  priorRv: number;
  finalRv: number;
}

function simulate(history: History): World {
  const events: Ev[] = [];
  let rv = WATCH_START;
  let state: State = "P";
  let carrier: Carrier = null;
  let uid: "U1" | "U2" = "U1";
  const emit = (type: Ev["type"] = "MODIFIED") => {
    rv += 1;
    events.push({ rv, type, uid, state, carrier });
  };

  if (history.otherGrantBefore && !history.noOp) {
    state = "T"; carrier = "G2"; emit();
    state = "P"; carrier = "G4"; emit();
  }
  if (history.statusBefore) emit();
  const priorRv = rv;

  if (history.attempt === "stored") {
    // The write persists. With T equal to P the object still changes: the
    // carrier annotation is set, which the object hash excludes.
    state = "T"; carrier = "G"; emit();
  }
  if (history.statusAfter) emit();

  if (history.later === "restores_prior" && state !== "P") { state = "P"; carrier = "G5"; emit(); }
  if (history.later === "via_other_grant") { state = "T"; carrier = "G3"; emit(); }
  if (history.later === "sets_target_no_carrier") { state = "T"; carrier = null; emit(); }
  if (history.later === "sets_target_copied_carrier") { state = "T"; carrier = "G"; emit(); }

  if (history.recreated) {
    emit("DELETED");
    uid = "U2"; state = "P"; carrier = null; emit("ADDED");
  }
  return { events, priorRv, finalRv: rv };
}

/** What happened to G's write. */
type Truth = "stored" | "rejected" | "not_consumed";
const truthOf = (history: History): Truth =>
  history.attempt === "stored" ? "stored" : history.attempt === "rejected_downstream" ? "rejected" : "not_consumed";

// --- The evidence ---------------------------------------------------------------

type AuditEdit = "none" | "drop" | "flip" | "fabricate_stored" | "hide_stored" | "inject_conflict";
type AuditClaim = "stored" | "rejected" | "absent" | "conflict";
type Coverage = "complete" | "late" | "cut" | "ended_abnormally";
type PriorKnowledge = "exact" | "lower_bound" | "none";

interface Observation {
  consumed: boolean;
  auditClaim: AuditClaim;
  coverage: Coverage;
  /** The events the observer received. */
  events: Ev[];
  streamStart: number;
  /** The object's version at close; a complete stream ends on it. */
  closedAt: number;
  priorRv: number | undefined;
  /** The grant carries both hashes, so the observer knows the target equals the prior state. */
  grantIsNoOp: boolean;
  assumeCarrierUnforgeable: boolean;
}

function auditClaimFor(history: History, edit: AuditEdit): AuditClaim {
  const truthful: AuditClaim = history.attempt === "stored" ? "stored" : history.attempt === "rejected_downstream" ? "rejected" : "absent";
  switch (edit) {
    case "none": return truthful;
    case "drop": return "absent";
    case "flip": return truthful === "rejected" ? "stored" : truthful === "stored" ? "rejected" : "absent";
    case "fabricate_stored": return "stored";
    case "hide_stored": return truthful === "stored" ? "rejected" : truthful;
    case "inject_conflict": return truthful === "absent" ? "absent" : "conflict";
  }
}

function observe(history: History, edit: AuditEdit, coverage: Coverage, prior: PriorKnowledge, assume: boolean): Observation {
  const world = simulate(history);
  const afterAdmission = world.events.filter(event => event.rv > world.priorRv);
  const firstAfter = afterAdmission[0];
  let events = world.events;
  let streamStart = WATCH_START;
  if (coverage === "late") {
    streamStart = firstAfter === undefined ? world.priorRv : firstAfter.rv;
    events = world.events.filter(event => event.rv > streamStart);
  } else if (coverage === "cut") {
    events = world.events.filter(event => event.rv <= world.priorRv);
  }
  return {
    consumed: history.attempt !== "not_attempted",
    auditClaim: auditClaimFor(history, edit),
    coverage,
    events,
    streamStart,
    closedAt: world.finalRv,
    priorRv: prior === "exact" ? world.priorRv : prior === "lower_bound" ? WATCH_START : undefined,
    grantIsNoOp: history.noOp,
    assumeCarrierUnforgeable: assume,
  };
}

// --- The contracts ----------------------------------------------------------------

type Verdict = "stored" | "rejected" | "not_consumed" | "unknown";

interface WindowFacts {
  covers: boolean;
  reachesClose: boolean;
  targetWithCarrier: boolean;
  targetWithoutCarrier: boolean;
  anyTargetState: boolean;
}

function windowOf(obs: Observation): WindowFacts {
  // Target-hash events are those in state T; in a no-op grant every state hashes to the target.
  const hashesToTarget = (event: Ev) => event.state === "T" || obs.grantIsNoOp;
  const inWindow = obs.priorRv === undefined ? [] : obs.events.filter(event => event.rv > (obs.priorRv ?? 0) && event.type !== "DELETED");
  const covers = obs.priorRv !== undefined && obs.streamStart <= obs.priorRv;
  const last = obs.events[obs.events.length - 1];
  const reachesClose = obs.coverage === "complete" && (last === undefined ? obs.streamStart === obs.closedAt : last.rv === obs.closedAt);
  return {
    covers,
    reachesClose,
    targetWithCarrier: inWindow.some(event => hashesToTarget(event) && event.carrier === "G"),
    targetWithoutCarrier: inWindow.some(event => hashesToTarget(event) && event.carrier !== "G"),
    anyTargetState: inWindow.some(hashesToTarget),
  };
}

type V1Rule = "carrier-event" | "target-without-carrier-contradicts-rejected" | "absence" | "audit-stored-fallback" | "audit-rejected-fallback" | "no-answer" | "not-consumed";

/**
 * Version 1: what experiments 01 to 06 each did, composed. A complete watch
 * first; with no definite answer from it, the audit event cross-checked by
 * a version-based read. A target state without this grant's carrier
 * contradicts a "rejected" claim. Returns the rule that decided, so a wrong
 * verdict can be attributed to the rule that produced it.
 */
function v1Traced(obs: Observation): { verdict: Verdict; rule: V1Rule } {
  if (!obs.consumed) return { verdict: "not_consumed", rule: "not-consumed" };
  const w = windowOf(obs);
  if (w.targetWithCarrier) return { verdict: "stored", rule: "carrier-event" };
  if (w.targetWithoutCarrier) {
    if (obs.auditClaim === "rejected") return { verdict: "stored", rule: "target-without-carrier-contradicts-rejected" };
    if (obs.auditClaim === "stored") return { verdict: "unknown", rule: "no-answer" };
  }
  if (w.covers && w.reachesClose && !w.anyTargetState) return { verdict: "rejected", rule: "absence" };
  // Fall back to the audit event, with the version-based cross-check.
  if (obs.auditClaim === "stored") {
    if (obs.priorRv !== undefined && obs.closedAt === obs.priorRv) return { verdict: "rejected", rule: "audit-rejected-fallback" };
    return { verdict: "stored", rule: "audit-stored-fallback" };
  }
  if (obs.auditClaim === "rejected") return { verdict: "rejected", rule: "audit-rejected-fallback" };
  return { verdict: "unknown", rule: "no-answer" };
}
const v1 = (obs: Observation): Verdict => v1Traced(obs).verdict;

/**
 * Version 2a, the repair pre-registered in the note: store only on an event
 * carrying this grant's id, treat any target state without it as unknown,
 * never give a definite verdict from the audit event alone, and say
 * nothing about a stored write whose target equals its prior state.
 */
function v2a(obs: Observation): Verdict {
  if (!obs.consumed) return "not_consumed";
  const w = windowOf(obs);
  if (!obs.assumeCarrierUnforgeable) {
    // Without the precondition a carrier proves nothing, and absence is
    // still evidence only if the stream is complete and no target state
    // appears at all.
    if (w.covers && w.reachesClose && !w.anyTargetState) return "rejected";
    return "unknown";
  }
  if (w.targetWithCarrier) return "stored";
  if (w.targetWithoutCarrier) return "unknown";
  if (w.covers && w.reachesClose) return "rejected";
  return "unknown";
}

/**
 * Version 2b: carrier-keyed. Absence of any event with this grant's carrier
 * in a complete, covering window is enough for "rejected", whatever other
 * target-state events appear, because an unforgeable carrier could only
 * have been set by this grant's own admission.
 */
function v2b(obs: Observation): Verdict {
  if (!obs.consumed) return "not_consumed";
  const w = windowOf(obs);
  if (!obs.assumeCarrierUnforgeable) {
    if (w.covers && w.reachesClose && !w.anyTargetState) return "rejected";
    return "unknown";
  }
  if (w.targetWithCarrier) return "stored";
  if (w.covers && w.reachesClose) return "rejected";
  return "unknown";
}

// --- Enumeration -----------------------------------------------------------------

const bool = [false, true] as const;
const attempts: Attempt[] = ["stored", "rejected_downstream", "not_attempted"];
const laters: Later[] = ["none", "restores_prior", "via_other_grant", "sets_target_no_carrier", "sets_target_copied_carrier"];
const tiers: Tier[] = ["protected", "default"];
const edits: AuditEdit[] = ["none", "drop", "flip", "fabricate_stored", "hide_stored", "inject_conflict"];
const coverages: Coverage[] = ["complete", "late", "cut", "ended_abnormally"];
const priors: PriorKnowledge[] = ["exact", "lower_bound", "none"];

/** A history the API server can produce: an unauthorized-looking write needs the default tier. */
function isValid(history: History): boolean {
  if (history.tier === "protected" && (history.later === "sets_target_no_carrier" || history.later === "sets_target_copied_carrier")) return false;
  return true;
}

function* histories(): Generator<History> {
  for (const attempt of attempts) for (const noOp of bool) for (const statusBefore of bool) for (const statusAfter of bool)
    for (const otherGrantBefore of bool) for (const later of laters) for (const recreated of bool) for (const tier of tiers) {
      const history: History = { attempt, noOp, statusBefore, statusAfter, otherGrantBefore, later, recreated, tier };
      if (isValid(history)) yield history;
    }
}

interface Row {
  history: History;
  edit: AuditEdit;
  coverage: Coverage;
  prior: PriorKnowledge;
  verdict: Verdict;
  truth: Truth;
}
const isDefinite = (verdict: Verdict) => verdict !== "unknown";
const isUnsound = (row: Row) => isDefinite(row.verdict) && row.verdict !== (row.truth === "not_consumed" ? "not_consumed" : row.truth);

function evaluate(contract: (obs: Observation) => Verdict, filter: (history: History, edit: AuditEdit, coverage: Coverage, prior: PriorKnowledge) => boolean, assumeFor: (tier: Tier) => boolean): Row[] {
  const rows: Row[] = [];
  for (const history of histories()) for (const edit of edits) for (const coverage of coverages) for (const prior of priors) {
    if (!filter(history, edit, coverage, prior)) continue;
    const obs = observe(history, edit, coverage, prior, assumeFor(history.tier));
    rows.push({ history, edit, coverage, prior, verdict: contract(obs), truth: truthOf(history) });
  }
  return rows;
}

const summarize = (rows: Row[]) => ({
  total: rows.length,
  definite: rows.filter(row => isDefinite(row.verdict)).length,
  unsound: rows.filter(isUnsound),
});
const completeExact = (_h: History, _e: AuditEdit, coverage: Coverage, prior: PriorKnowledge) => coverage === "complete" && prior === "exact";
const protectedOnly = (history: History) => history.tier === "protected";

const assumeUnforgeable = () => true;

describe("M4-07 the enumeration itself", () => {
  it("covers every valid history under every audit edit, coverage and prior, each with a defined truth", () => {
    const all = [...histories()];
    const rows = evaluate(v1, () => true, assumeUnforgeable);
    expect(rows.length).toBe(all.length * edits.length * coverages.length * priors.length);
    expect(rows.every(row => ["stored", "rejected", "not_consumed"].includes(row.truth))).toBe(true);
    // 288 protected histories, 6 audit edits: the first table's population.
    expect(evaluate(v1, (h, e, c, p) => completeExact(h, e, c, p) && protectedOnly(h), assumeUnforgeable)).toHaveLength(1728);
  });
});

describe("M4-07 version 1, composed from experiments 01 to 06", () => {
  const scope = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && protectedOnly(h);

  it("H7a and H7b: unsound under a complete watch, an exact prior and an unforgeable carrier, by one rule", () => {
    const rows = evaluate(v1, scope, assumeUnforgeable);
    const { unsound, definite } = summarize(rows);
    expect(definite).toBe(1504);
    expect(unsound).toHaveLength(112);
    // Every wrong verdict is produced by the rule that reads a target state
    // without this grant's carrier as a contradiction of a "rejected" claim.
    for (const row of unsound) {
      expect(v1Traced(observe(row.history, row.edit, row.coverage, row.prior, true)).rule).toBe("target-without-carrier-contradicts-rejected");
      expect(row.truth).toBe("rejected");
      expect(row.verdict).toBe("stored");
    }
    // 80 of them are a no-op target (every state hashes to the target, so
    // "a target state without the carrier" is always present); the other 32
    // need another grant to have stored the target after this admission.
    const noOp = unsound.filter(row => row.history.noOp);
    const other = unsound.filter(row => !row.history.noOp);
    expect(noOp).toHaveLength(80);
    expect(other).toHaveLength(32);
    expect(other.every(row => row.history.later === "via_other_grant")).toBe(true);
  });

  it("H7c: a prior known only as a lower bound adds unsound histories, from events that precede the admission", () => {
    const exact = evaluate(v1, scope, assumeUnforgeable).filter(isUnsound);
    const lower = evaluate(v1, (h, _e, c, p) => protectedOnly(h) && c === "complete" && p === "lower_bound", assumeUnforgeable).filter(isUnsound);
    expect(lower).toHaveLength(152);
    const exactKeys = new Set(exact.map(row => JSON.stringify([row.history, row.edit])));
    const added = lower.filter(row => !exactKeys.has(JSON.stringify([row.history, row.edit])));
    expect(added).toHaveLength(40);
    // A wider window admits events from before the admission: another
    // grant's earlier write, or, for a no-op target (where every state
    // hashes to it), the status-only events that preceded the admission.
    expect(added.every(row => row.history.otherGrantBefore || (row.history.noOp && row.history.statusBefore))).toBe(true);
    expect(added.some(row => row.history.otherGrantBefore && !row.history.noOp)).toBe(true);
  });

  it("with the audit event edited, no coverage and no prior, version 1's definite verdicts are unsound far more often", () => {
    const all = summarize(evaluate(v1, (h, _e, _c, p) => protectedOnly(h) && p === "exact", assumeUnforgeable));
    expect(all.unsound.length).toBeGreaterThan(112);
    // The audit-fallback rules appear only once the watch cannot answer.
    const rules = new Set(all.unsound.map(row => v1Traced(observe(row.history, row.edit, row.coverage, row.prior, true)).rule));
    expect(rules.has("audit-stored-fallback")).toBe(true);
    expect(rules.has("audit-rejected-fallback")).toBe(true);
  });
});

describe("M4-07 the repaired contracts", () => {
  it("H7d: v2a and v2b return no unsound definite verdict in the protected tier, for any prior, coverage or audit edit", () => {
    for (const contract of [v2a, v2b]) {
      const rows = evaluate(contract, protectedOnly, assumeUnforgeable);
      expect(summarize(rows).unsound).toEqual([]);
      expect(rows.length).toBe(288 * edits.length * coverages.length * priors.length);
    }
  });

  it("v2b is definite everywhere under a complete watch and an exact prior; v2a leaves a fifth unknown", () => {
    const scope = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && protectedOnly(h);
    const a = summarize(evaluate(v2a, scope, assumeUnforgeable));
    const b = summarize(evaluate(v2b, scope, assumeUnforgeable));
    expect(b.definite).toBe(b.total);
    expect(a.definite).toBe(1392);
    expect(a.total - a.definite).toBe(336);
  });

  it("neither repair reads the audit event: the verdict does not change across audit edits", () => {
    for (const contract of [v2a, v2b]) {
      const byScenario = new Map<string, Set<Verdict>>();
      for (const row of evaluate(contract, () => true, assumeUnforgeable)) {
        const key = JSON.stringify([row.history, row.coverage, row.prior]);
        const seen = byScenario.get(key) ?? new Set<Verdict>();
        seen.add(row.verdict);
        byScenario.set(key, seen);
      }
      expect([...byScenario.values()].every(verdicts => verdicts.size === 1)).toBe(true);
    }
  });

  it("without a complete watch or a prior, the repairs say unknown about absence rather than guess", () => {
    const rows = evaluate(v2b, (h, _e, c, p) => protectedOnly(h) && (c !== "complete" || p !== "exact"), assumeUnforgeable);
    const rejectedRows = rows.filter(row => row.verdict === "rejected");
    // A "rejected" verdict needs a complete watch from at or before an exact or lower-bound prior.
    expect(rejectedRows.every(row => row.coverage === "complete" && row.prior !== "none")).toBe(true);
    expect(rows.filter(row => row.coverage === "ended_abnormally" && row.truth === "rejected").every(row => row.verdict === "unknown")).toBe(true);
  });
});

describe("M4-07 the carrier precondition", () => {
  it("H7e: where a writer outside the enforcer can copy the carrier, assuming it unforgeable is unsound", () => {
    const scope = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && h.tier === "default";
    for (const contract of [v2a, v2b]) {
      const { unsound } = summarize(evaluate(contract, scope, () => true));
      expect(unsound).toHaveLength(192);
      expect(unsound.every(row => row.history.later === "sets_target_copied_carrier" && row.truth === "rejected" && row.verdict === "stored")).toBe(true);
    }
  });

  it("not assuming it, the repairs are sound in the default tier and say unknown where a carrier is all there is", () => {
    const scope = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && h.tier === "default";
    for (const contract of [v2a, v2b]) {
      const { unsound, definite, total } = summarize(evaluate(contract, scope, () => false));
      expect(unsound).toEqual([]);
      expect(definite).toBe(1200);
      expect(total).toBe(2880);
    }
  });
});
