import { describe, expect, it } from "vitest";

import { canonicalize, canonicallyEqual } from "@/lib/receipt/canonical";
import { hashCanonical, sha256Hex } from "@/lib/receipt/hash";

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is independent of key insertion order", () => {
    const first = { alpha: 1, beta: { x: true, y: "z" } };
    const second = { beta: { y: "z", x: true }, alpha: 1 };
    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(canonicallyEqual(first, second)).toBe(true);
  });

  it("preserves array order", () => {
    expect(canonicalize({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
    expect(canonicallyEqual({ list: [1, 2] }, { list: [2, 1] })).toBe(false);
  });

  it("drops undefined properties like JSON does", () => {
    expect(canonicalize({ a: 1, gone: undefined })).toBe('{"a":1}');
  });

  it("rejects non-plain objects and non-finite numbers", () => {
    expect(() => canonicalize(new Date())).toThrow();
    expect(() => canonicalize({ value: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalize({ fn: () => 1 })).toThrow();
  });
});

describe("sha256", () => {
  it("produces the well-known digest for an empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes canonically equal objects identically regardless of key order", async () => {
    const a = await hashCanonical({ x: 1, y: [1, 2, 3], z: { k: "v" } });
    const b = await hashCanonical({ z: { k: "v" }, y: [1, 2, 3], x: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any semantic content changes", async () => {
    const a = await hashCanonical({ x: 1 });
    const b = await hashCanonical({ x: 2 });
    expect(a).not.toBe(b);
  });
});
