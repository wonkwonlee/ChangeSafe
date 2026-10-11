/**
 * The evidence model and the contracts of M4 experiment 07
 * (docs/M4_EXPERIMENT_07.md), shared by the enumeration test and by
 * a later experiment in this stack (the Terraform check). A bounded exhaustive check of
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

export type State = "P" | "T";
export type Carrier = null | "G" | "G2" | "G3" | "G4" | "G5";
export interface Ev {
  rv: number;
  type: "ADDED" | "MODIFIED" | "DELETED";
  uid: "U1" | "U2";
  state: State;
  carrier: Carrier;
}

export type Attempt = "stored" | "rejected_downstream" | "not_attempted";
export type Later = "none" | "restores_prior" | "via_other_grant" | "sets_target_no_carrier" | "sets_target_copied_carrier";
export type Tier = "protected" | "default";

export interface History {
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

export const WATCH_START = 100;

export interface World {
  events: Ev[];
  /** The version the enforcer saw at G's admission. */
  priorRv: number;
  finalRv: number;
}

export function simulate(history: History): World {
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
export type Truth = "stored" | "rejected" | "not_consumed";
export const truthOf = (history: History): Truth =>
  history.attempt === "stored" ? "stored" : history.attempt === "rejected_downstream" ? "rejected" : "not_consumed";

// --- The evidence ---------------------------------------------------------------

export type AuditEdit = "none" | "drop" | "flip" | "fabricate_stored" | "hide_stored" | "inject_conflict";
export type AuditClaim = "stored" | "rejected" | "absent" | "conflict";
export type Coverage = "complete" | "late" | "cut" | "cut_after_write" | "ended_abnormally";
export type PriorKnowledge = "exact" | "lower_bound" | "none";

export interface Observation {
  consumed: boolean;
  auditClaim: AuditClaim;
  coverage: Coverage;
  /** The events the observer received. */
  events: Ev[];
  streamStart: number;
  /** The object's version at close; a complete stream ends on it. */
  closedAt: number;
  /** Alive when closed, nothing on stderr, no in-band ERROR event: observed, not derivable from the events. */
  endedCleanly: boolean;
  priorRv: number | undefined;
  /** The grant carries both hashes, so the observer knows the target equals the prior state. */
  grantIsNoOp: boolean;
  assumeCarrierUnforgeable: boolean;
}

export function auditClaimFor(history: History, edit: AuditEdit): AuditClaim {
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

export interface ObserveOptions {
  /**
   * The enforcer's use-state is evidence too. It is outside the attack model
   * (SQLite immutability triggers and the ledger's hash chain protect it,
   * invariant 12), and trusted here. Setting this shows what happens when it
   * is not: the contract has no other source for "was this grant consumed".
   */
  useStateEdit?: "hide_consumption" | "forge_consumption";
  /**
   * An adversary on the observer's own path removes every event that carries
   * the grant from an otherwise complete stream. Outside the attack
   * model (invariant: the watch is as trustworthy as the API server), and
   * included so the contract's blind spot is shown, not hidden.
   */
  dropWriteEvent?: boolean;
}

export function observe(history: History, edit: AuditEdit, coverage: Coverage, prior: PriorKnowledge, assume: boolean, options: ObserveOptions = {}): Observation {
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
  } else if (coverage === "cut_after_write") {
    // The stream ends just after the grant's write (or, with no write, just
    // after the first event past the admission): the failure experiment 05's
    // first review found, a stream that stops before the end.
    const write = afterAdmission.find(event => event.carrier === "G");
    const stopAt = write?.rv ?? firstAfter?.rv ?? world.priorRv;
    events = world.events.filter(event => event.rv <= stopAt);
  }
  if (options.dropWriteEvent === true) events = events.filter(event => !(event.carrier === "G" && event.rv > world.priorRv));
  return {
    consumed: options.useStateEdit === "hide_consumption" ? false
      : options.useStateEdit === "forge_consumption" ? true
      : history.attempt !== "not_attempted",
    auditClaim: auditClaimFor(history, edit),
    coverage,
    events,
    streamStart,
    closedAt: world.finalRv,
    endedCleanly: coverage !== "ended_abnormally",
    priorRv: prior === "exact" ? world.priorRv : prior === "lower_bound" ? WATCH_START : undefined,
    grantIsNoOp: history.noOp,
    assumeCarrierUnforgeable: assume,
  };
}

// --- The contracts ----------------------------------------------------------------

export type Verdict = "stored" | "rejected" | "not_consumed" | "unknown";

export interface WindowFacts {
  covers: boolean;
  reachesClose: boolean;
  targetWithCarrier: boolean;
  targetWithoutCarrier: boolean;
  anyTargetState: boolean;
}

export function windowOf(obs: Observation): WindowFacts {
  // Target-hash events are those in state T; in a no-op grant every state hashes to the target.
  const hashesToTarget = (event: Ev) => event.state === "T" || obs.grantIsNoOp;
  const priorRv = obs.priorRv;
  const inWindow = priorRv === undefined ? [] : obs.events.filter(event => event.rv > priorRv && event.type !== "DELETED");
  const covers = priorRv !== undefined && obs.streamStart <= priorRv;
  const last = obs.events[obs.events.length - 1];
  // Derived from the stream, not from its label: the last event carries the
  // object's version at close (or, with no events, the stream began there),
  // and the stream ended cleanly.
  const reachesClose = obs.endedCleanly && (last === undefined ? obs.streamStart === obs.closedAt : last.rv === obs.closedAt);
  return {
    covers,
    reachesClose,
    targetWithCarrier: inWindow.some(event => hashesToTarget(event) && event.carrier === "G"),
    targetWithoutCarrier: inWindow.some(event => hashesToTarget(event) && event.carrier !== "G"),
    anyTargetState: inWindow.some(hashesToTarget),
  };
}

export type V1Rule = "carrier-event" | "target-without-carrier-contradicts-rejected" | "absence" | "audit-stored-fallback" | "audit-rejected-fallback" | "no-answer" | "not-consumed";

/**
 * Version 1: what experiments 01 to 06 each did, composed. A complete watch
 * first; with no definite answer from it, the audit event cross-checked by
 * a version-based read. A target state without this grant's carrier
 * contradicts a "rejected" claim. Returns the rule that decided, so a wrong
 * verdict can be attributed to the rule that produced it.
 */
export function v1Traced(
  obs: Observation,
  carrierlessTarget: "contradicts-rejected" | "unattributed" = "contradicts-rejected",
): { verdict: Verdict; rule: V1Rule } {
  if (!obs.consumed) return { verdict: "not_consumed", rule: "not-consumed" };
  const w = windowOf(obs);
  if (w.targetWithCarrier) return { verdict: "stored", rule: "carrier-event" };
  if (w.targetWithoutCarrier) {
    if (carrierlessTarget === "unattributed") return { verdict: "unknown", rule: "no-answer" };
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
export const v1 = (obs: Observation): Verdict => v1Traced(obs).verdict;

/**
 * Version 1c: the same composition with experiment 05's rule as corrected by
 * its review (a target state without the carrier is unattributed, neither
 * claim contradicted). This, not v1, is what the project would have run.
 */
export const v1c = (obs: Observation): Verdict => v1Traced(obs, "unattributed").verdict;

/**
 * Version 2a, the repair pre-registered in the note: store only on an event
 * carrying this grant's id, treat any target state without it as unknown,
 * never give a definite verdict from the audit event alone, and say
 * nothing about a stored write whose target equals its prior state.
 */
export function v2a(obs: Observation): Verdict {
  if (!obs.consumed) return "not_consumed";
  // "Require that T differs from P": the grant carries both hashes, so the
  // observer knows when the spec change is empty, and says nothing about it.
  if (obs.grantIsNoOp) return "unknown";
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
export function v2b(obs: Observation): Verdict {
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

export const bool = [false, true] as const;
export const attempts: Attempt[] = ["stored", "rejected_downstream", "not_attempted"];
export const laters: Later[] = ["none", "restores_prior", "via_other_grant", "sets_target_no_carrier", "sets_target_copied_carrier"];
export const tiers: Tier[] = ["protected", "default"];
export const edits: AuditEdit[] = ["none", "drop", "flip", "fabricate_stored", "hide_stored", "inject_conflict"];
export const coverages: Coverage[] = ["complete", "late", "cut", "cut_after_write", "ended_abnormally"];
export const priors: PriorKnowledge[] = ["exact", "lower_bound", "none"];

/** A history the API server can produce: an unauthorized-looking write needs the default tier. */
export function isValid(history: History): boolean {
  if (history.tier === "protected" && (history.later === "sets_target_no_carrier" || history.later === "sets_target_copied_carrier")) return false;
  return true;
}

export function* histories(): Generator<History> {
  for (const attempt of attempts) for (const noOp of bool) for (const statusBefore of bool) for (const statusAfter of bool)
    for (const otherGrantBefore of bool) for (const later of laters) for (const recreated of bool) for (const tier of tiers) {
      const history: History = { attempt, noOp, statusBefore, statusAfter, otherGrantBefore, later, recreated, tier };
      if (isValid(history)) yield history;
    }
}

export interface Row {
  history: History;
  edit: AuditEdit;
  coverage: Coverage;
  prior: PriorKnowledge;
  verdict: Verdict;
  truth: Truth;
}
export const isDefinite = (verdict: Verdict) => verdict !== "unknown";
export const isUnsound = (row: Row) => isDefinite(row.verdict) && row.verdict !== row.truth;

export function evaluate(contract: (obs: Observation) => Verdict, filter: (history: History, edit: AuditEdit, coverage: Coverage, prior: PriorKnowledge) => boolean, assumeFor: (tier: Tier) => boolean): Row[] {
  const rows: Row[] = [];
  for (const history of histories()) for (const edit of edits) for (const coverage of coverages) for (const prior of priors) {
    if (!filter(history, edit, coverage, prior)) continue;
    const obs = observe(history, edit, coverage, prior, assumeFor(history.tier));
    rows.push({ history, edit, coverage, prior, verdict: contract(obs), truth: truthOf(history) });
  }
  return rows;
}

export const summarize = (rows: Row[]) => ({
  total: rows.length,
  definite: rows.filter(row => isDefinite(row.verdict)).length,
  unsound: rows.filter(isUnsound),
});
export const completeExact = (_h: History, _e: AuditEdit, coverage: Coverage, prior: PriorKnowledge) => coverage === "complete" && prior === "exact";
export const protectedOnly = (history: History) => history.tier === "protected";


/** Distinct worlds among a set of histories: parameter tuples can produce the same events. */
export function distinctWorlds(items: Iterable<History>): number {
  const seen = new Set<string>();
  for (const history of items) {
    const world = simulate(history);
    seen.add(JSON.stringify([world.events, world.priorRv, history.noOp, truthOf(history)]));
  }
  return seen.size;
}
