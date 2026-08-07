import { describe, expect, it } from "vitest";

import {
  computeLineDiff,
  formatLeafChange,
  summarizeLeafChanges,
} from "../../components/diffLines";

describe("computeLineDiff", () => {
  it("marks unchanged lines as context and changed lines as add/remove", () => {
    const before = "a\nb\nc";
    const after = "a\nx\nc";
    expect(computeLineDiff(before, after)).toEqual([
      { type: "context", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "x" },
      { type: "context", text: "c" },
    ]);
  });

  it("handles pure insertion and pure deletion", () => {
    expect(computeLineDiff("a\nb", "a\nb\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "context", text: "b" },
      { type: "add", text: "c" },
    ]);
    expect(computeLineDiff("a\nb\nc", "a\nb")).toEqual([
      { type: "context", text: "a" },
      { type: "context", text: "b" },
      { type: "remove", text: "c" },
    ]);
  });

  it("returns null instead of doing expensive work above the line-count bound", () => {
    const huge = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    expect(computeLineDiff(huge, "x")).toBeNull();
    expect(computeLineDiff("x", huge)).toBeNull();
  });

  it("returns an empty diff for identical text", () => {
    expect(computeLineDiff("same", "same")).toEqual([{ type: "context", text: "same" }]);
  });
});

describe("summarizeLeafChanges", () => {
  it("finds a single changed leaf inside an otherwise identical object", () => {
    const before = { spec: { replicas: 2, image: "web:v1" } };
    const after = { spec: { replicas: 2, image: "web:v2" } };
    expect(summarizeLeafChanges(before, after)).toEqual([
      { path: "spec.image", before: "web:v1", after: "web:v2" },
    ]);
  });

  it("reports multiple changed leaves in traversal order", () => {
    const before = { a: 1, b: 2 };
    const after = { a: 9, b: 2, c: 3 };
    expect(summarizeLeafChanges(before, after)).toEqual([
      { path: "a", before: 1, after: 9 },
      { path: "c", before: undefined, after: 3 },
    ]);
  });

  it("caps the number of collected changes so a huge diff stays cheap", () => {
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      before[`k${i}`] = i;
      after[`k${i}`] = i + 1;
    }
    expect(summarizeLeafChanges(before, after)).toHaveLength(6);
  });

  it("returns nothing for identical values", () => {
    expect(summarizeLeafChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe("formatLeafChange", () => {
  it("renders a path: before → after line, using (absent) for undefined", () => {
    expect(formatLeafChange({ path: "spec.replicas", before: 2, after: 3 })).toBe(
      "spec.replicas: 2 → 3",
    );
    expect(formatLeafChange({ path: "spec.newField", before: undefined, after: "x" })).toBe(
      'spec.newField: (absent) → "x"',
    );
  });
});
