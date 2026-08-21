import { describe, expect, it } from "vitest";
import { createInMemoryGrantUseRegistry } from "../src/use-state";

const T0 = Date.parse("2026-08-19T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("createInMemoryGrantUseRegistry (CS-ADV-018)", () => {
  it("consumes a grant id exactly once", () => {
    const uses = createInMemoryGrantUseRegistry();
    expect(uses.consume("grant-a", T0 + HOUR, T0)).toBe(true);
    expect(uses.consume("grant-a", T0 + HOUR, T0 + 1)).toBe(false);
    expect(uses.consume("grant-a", T0 + HOUR, T0 + HOUR - 1)).toBe(false);
  });

  it("keeps distinct grant ids independent", () => {
    const uses = createInMemoryGrantUseRegistry();
    expect(uses.consume("grant-a", T0 + HOUR, T0)).toBe(true);
    expect(uses.consume("grant-b", T0 + HOUR, T0)).toBe(true);
  });

  it("forgets a record once its grant has expired, and only then", () => {
    // Bounded memory: the record only needs to outlive the grant, because
    // an expired grant is refused by verification before use-state is
    // ever consulted. Re-consuming after expiry is therefore harmless and
    // lets the registry stay small in a long-lived process.
    const uses = createInMemoryGrantUseRegistry();
    expect(uses.consume("grant-a", T0 + HOUR, T0)).toBe(true);
    expect(uses.consume("grant-a", T0 + HOUR, T0 + HOUR - 1)).toBe(false);
    expect(uses.consume("grant-a", T0 + HOUR, T0 + HOUR)).toBe(true);
  });

  it("is atomic under interleaved callers within one process", () => {
    // Node is single-threaded, so consume() cannot be preempted mid-call;
    // a burst of identical attempts yields exactly one winner.
    const uses = createInMemoryGrantUseRegistry();
    const outcomes = Array.from({ length: 50 }, () => uses.consume("grant-a", T0 + HOUR, T0));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });
});
