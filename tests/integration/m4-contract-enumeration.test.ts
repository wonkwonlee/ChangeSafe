import { describe, expect, it } from "vitest";
import {
  completeExact, coverages, edits, evaluate, histories, isDefinite, isUnsound, observe, priors, protectedOnly,
  summarize, v1, v1c, v1Traced, v2a, v2b, distinctWorlds,
  type AuditEdit, type Coverage, type History, type PriorKnowledge, type Verdict,
} from "./m4-evidence-model";

/**
 * M4 experiment 07 (docs/M4_EXPERIMENT_07.md): the assertions over the
 * bounded exhaustive check. The model and the contracts are in
 * m4-evidence-model.ts, shared with experiment 08.
 */

const assumeUnforgeable = () => true;
const scopeA = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && protectedOnly(h);

describe("M4-07 the enumeration itself", () => {
  it("covers every valid history under every audit edit, coverage and prior, each with a defined truth", () => {
    const all = [...histories()];
    const rows = evaluate(v1, () => true, assumeUnforgeable);
    expect(rows.length).toBe(all.length * edits.length * coverages.length * priors.length);
    expect(rows.every(row => ["stored", "rejected", "not_consumed"].includes(row.truth))).toBe(true);
    expect(evaluate(v1, scopeA, assumeUnforgeable)).toHaveLength(1728);
  });

  it("states how many of those histories are distinct worlds, since some parameters do nothing in some combinations", () => {
    // Review finding: a parameter tuple is not a world. otherGrantBefore is
    // inert for a no-op target, restores_prior is inert unless the state
    // moved, and so on. The counts quoted in the note are of tuples; the
    // distinct worlds are fewer, and soundness is a claim over those.
    const all = [...histories()];
    expect(all).toHaveLength(768);
    expect(distinctWorlds(all)).toBe(300);
    const protectedHistories = all.filter(history => history.tier === "protected");
    expect(protectedHistories).toHaveLength(288);
    expect(distinctWorlds(protectedHistories)).toBe(168);
  });
});

describe("M4-07 version 1, composed from experiments 01 to 06", () => {
  it("H7a (refuted as stated) and H7b: the pre-correction rule is unsound in scope A, and by one rule", () => {
    const { unsound, definite } = summarize(evaluate(v1, scopeA, assumeUnforgeable));
    expect(definite).toBe(1504);
    expect(unsound).toHaveLength(112);
    // Every wrong verdict is produced by the rule that reads a target state
    // without this grant's carrier as a contradiction of a "rejected" claim.
    for (const row of unsound) {
      expect(v1Traced(observe(row.history, row.edit, row.coverage, row.prior, true)).rule).toBe("target-without-carrier-contradicts-rejected");
      expect(row.truth).toBe("rejected");
      expect(row.verdict).toBe("stored");
    }
    // H7a registered "except where T equals P". 80 rows are that; the other
    // 32 are outside the registered exception and need another grant to have
    // stored the target after this admission (H7b's mechanism).
    const noOp = unsound.filter(row => row.history.noOp);
    const other = unsound.filter(row => !row.history.noOp);
    expect(noOp).toHaveLength(80);
    expect(other).toHaveLength(32);
    expect(other.every(row => row.history.later === "via_other_grant")).toBe(true);
  });

  it("v1c, the composition with experiment 05's corrected rule, is sound in scope A", () => {
    // The rule that makes v1 unsound was removed from 05 by its review. v1 is
    // the pre-correction composition; v1c is what the project would have run.
    expect(summarize(evaluate(v1c, scopeA, assumeUnforgeable)).unsound).toEqual([]);
  });

  it("H7c: a prior known only as a lower bound adds unsound histories, from events that precede the admission", () => {
    const exact = evaluate(v1, (h, _e, c, p) => completeExact(h, _e, c, p) && protectedOnly(h) && c === "complete", assumeUnforgeable).filter(isUnsound);
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

  it("outside scope A the audit-fallback rules produce wrong verdicts, in v1 and in v1c: experiment 04 at scale", () => {
    const filter = (h: History, _e: AuditEdit, _c: Coverage, p: PriorKnowledge) => protectedOnly(h) && p === "exact";
    const v1Rows = summarize(evaluate(v1, filter, assumeUnforgeable));
    expect(v1Rows.total).toBe(8640);
    expect(v1Rows.unsound).toHaveLength(984);
    const byRule: Record<string, number> = {};
    for (const row of v1Rows.unsound) {
      const rule = v1Traced(observe(row.history, row.edit, row.coverage, row.prior, true)).rule;
      byRule[rule] = (byRule[rule] ?? 0) + 1;
    }
    expect(byRule).toEqual({
      "audit-rejected-fallback": 232,
      "audit-stored-fallback": 376,
      "target-without-carrier-contradicts-rejected": 376,
    });
    expect(summarize(evaluate(v1c, filter, assumeUnforgeable)).unsound).toHaveLength(608);
  });
});

describe("M4-07 the repaired contracts", () => {
  it("H7d: v2a and v2b return no unsound definite verdict in the protected tier, for any prior, coverage or audit edit", () => {
    for (const contract of [v2a, v2b]) {
      const rows = evaluate(contract, protectedOnly, assumeUnforgeable);
      expect(summarize(rows).unsound).toEqual([]);
      expect(rows).toHaveLength(288 * edits.length * coverages.length * priors.length);
    }
  });

  it("in scope A v2b is definite everywhere; v2a, which says nothing about a no-op target, leaves 672 unknown", () => {
    const a = summarize(evaluate(v2a, scopeA, assumeUnforgeable));
    const b = summarize(evaluate(v2b, scopeA, assumeUnforgeable));
    expect(b.definite).toBe(b.total);
    expect(a.definite).toBe(1056);
    expect(a.total - a.definite).toBe(672);
    // The unknowns are exactly the no-op targets (and what 2a refuses to attribute without a carrier).
    expect(evaluate(v2a, scopeA, assumeUnforgeable)
      .filter(row => !isDefinite(row.verdict) && !row.history.noOp).every(row => row.truth !== "not_consumed")).toBe(true);
  });

  it("over every protected evaluation v2b is definite on 13,824 of 25,920, and v2a on 10,944", () => {
    expect(summarize(evaluate(v2b, protectedOnly, assumeUnforgeable)).definite).toBe(13824);
    expect(summarize(evaluate(v2a, protectedOnly, assumeUnforgeable)).definite).toBe(10944);
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

  it("every missing piece of coverage moves 'rejected' to 'unknown', never to a wrong verdict", () => {
    const rows = evaluate(v2b, (h, _e, c, p) => protectedOnly(h) && (c !== "complete" || p !== "exact"), assumeUnforgeable);
    // A "rejected" verdict needs a complete stream and an exact or lower-bound prior.
    expect(rows.filter(row => row.verdict === "rejected").every(row => row.coverage === "complete" && row.prior !== "none")).toBe(true);
    // A stream cut after the write, the failure experiment 05's review found.
    const cut = rows.filter(row => row.coverage === "cut_after_write" && row.truth === "rejected");
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.every(row => row.verdict === "unknown")).toBe(true);
    expect(rows.filter(row => row.coverage === "ended_abnormally" && row.truth === "rejected").every(row => row.verdict === "unknown")).toBe(true);
  });

  it("LIMIT: an adversary on the observer's own path who removes the grant's events is detected only when they were last", () => {
    // Stated, not solved: outside the attack model, the same as for a read.
    // Removing every event that carries the grant from the stream:
    //  - when one of them was the stream's last, the close marker no longer
    //    matches and the verdict is unknown;
    //  - when a later writer's event follows, the marker still matches, and
    //    v2b says "rejected" for a write that was stored.
    const stored = [...histories()].filter(h => h.tier === "protected" && h.attempt === "stored" && !h.noOp && !h.recreated);
    const lastWasCarried = stored.filter(h => h.later === "none");
    const followed = stored.filter(h => h.later === "restores_prior" || h.later === "via_other_grant");
    expect(lastWasCarried.length).toBeGreaterThan(0);
    expect(followed.length).toBeGreaterThan(0);
    for (const history of lastWasCarried) {
      expect(v2b(observe(history, "none", "complete", "exact", true))).toBe("stored");
      expect(v2b(observe(history, "none", "complete", "exact", true, { dropWriteEvent: true }))).toBe("unknown");
    }
    for (const history of followed) {
      expect(v2b(observe(history, "none", "complete", "exact", true))).toBe("stored");
      expect(v2b(observe(history, "none", "complete", "exact", true, { dropWriteEvent: true }))).toBe("rejected");
    }
  });
});

describe("M4-07 the carrier precondition", () => {
  const scopeDefault = (h: History, e: AuditEdit, c: Coverage, p: PriorKnowledge) => completeExact(h, e, c, p) && h.tier === "default";

  it("H7e: where a writer outside the enforcer can copy the carrier, assuming it unforgeable is unsound", () => {
    const b = summarize(evaluate(v2b, scopeDefault, () => true));
    expect(b.unsound).toHaveLength(192);
    expect(b.unsound.every(row => row.history.later === "sets_target_copied_carrier" && row.truth === "rejected" && row.verdict === "stored")).toBe(true);
    // v2a gives up on a no-op target, which removes half of those rows.
    const a = summarize(evaluate(v2a, scopeDefault, () => true));
    expect(a.unsound).toHaveLength(96);
    expect(a.unsound.every(row => row.history.later === "sets_target_copied_carrier" && !row.history.noOp)).toBe(true);
  });

  it("not assuming it, the repairs are sound in the default tier and say unknown where a carrier is all there is", () => {
    for (const [contract, definite] of [[v2a, 1152], [v2b, 1200]] as const) {
      const result = summarize(evaluate(contract, scopeDefault, () => false));
      expect(result.unsound).toEqual([]);
      expect(result.definite).toBe(definite);
      expect(result.total).toBe(2880);
    }
  });
});
