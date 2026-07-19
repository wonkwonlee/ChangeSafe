import { describe, expect, it } from "vitest";

import { deriveInverseOperations } from "@/lib/patch/inverse";
import { verifyRollback } from "@/lib/patch/rollback-verify";
import { buildIncidentBundle, buildOperation } from "@/tests/helpers/fixtures";

const state = () => buildIncidentBundle().currentState;

describe("deriveInverseOperations", () => {
  it("derives restoring inverses for replace, add, and remove in reverse order", () => {
    const forward = [
      buildOperation(), // replace metric 200 -> 5
      buildOperation({
        op: "remove",
        path: "/devices/edge-rtr-01/routes/rt-default-primary",
        value: null,
      }),
      buildOperation({
        op: "add",
        path: "/devices/edge-rtr-01/routes/rt-new",
        value: {
          id: "rt-new",
          destination: "198.51.100.0/24",
          nextHop: "203.0.113.1",
          metric: 10,
          kind: "static",
          protected: false,
          description: null,
        },
      }),
    ];

    const original = state();
    const inverse = deriveInverseOperations(original, forward);

    expect(inverse.map((op) => op.op)).toEqual(["remove", "add", "replace"]);
    expect(verifyRollback(original, forward, inverse)).toEqual({ ok: true });
  });
});

describe("verifyRollback", () => {
  it("accepts the proposal's own correct rollback", () => {
    const bundle = buildIncidentBundle();
    const verdict = verifyRollback(
      bundle.currentState,
      [buildOperation()],
      [buildOperation({ value: 200 })],
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("fails when rollback is missing", () => {
    const verdict = verifyRollback(state(), [buildOperation()], []);
    expect(verdict.ok).toBe(false);
  });

  it("fails when rollback restores the wrong value", () => {
    const verdict = verifyRollback(
      state(),
      [buildOperation()],
      [buildOperation({ value: 100 })],
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("does not restore");
    }
  });

  it("fails when the rollback cannot be applied", () => {
    const verdict = verifyRollback(
      state(),
      [buildOperation()],
      [buildOperation({ path: "/devices/edge-rtr-01/routes/rt-ghost/metric", value: 200 })],
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("rollback operations failed to apply");
    }
  });

  it("fails when forward operations cannot be applied", () => {
    const verdict = verifyRollback(
      state(),
      [buildOperation({ path: "/devices/edge-rtr-01/name" })],
      [buildOperation({ value: 200 })],
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("forward operations failed to apply");
    }
  });
});
