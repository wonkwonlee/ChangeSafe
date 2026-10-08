import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteGrantUseRegistry } from "../src/sqlite-use-state";

describe("persistent single use across enforcer lifetimes and connections", () => {
  it("one shared SQLite file accepts one consumer and refuses restart/replay", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-grants-"));
    const file = path.join(dir, "uses.db");
    const first = SqliteGrantUseRegistry.open(file);
    const second = SqliteGrantUseRegistry.open(file);
    try {
      const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        Promise.resolve().then(() => (index % 2 ? first : second).consume("grant-shared-one", 10000, 1))));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(first.consume("grant-expired", 10000, 10000)).toBe(false);
    } finally { first.close(); second.close(); }
    const restarted = SqliteGrantUseRegistry.open(file);
    try { expect(restarted.consume("grant-shared-one", 10000, 2)).toBe(false); }
    finally { restarted.close(); rmSync(dir, { recursive: true }); }
  });
  it("refuses an ephemeral runtime database", () => {
    expect(() => SqliteGrantUseRegistry.open(":memory:")).toThrow("Persistent");
  });
});


it.skipIf(!existsSync(path.resolve("packages/kubernetes-enforcer/dist/sqlite-use-state.js")))("atomically consumes a shared grant across independent Node processes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-process-grants-"));
  const file = path.join(dir, "uses.db");
  const initial = SqliteGrantUseRegistry.open(file);
  initial.close();
  const moduleUrl = pathToFileURL(path.resolve("packages/kubernetes-enforcer/dist/sqlite-use-state.js")).href;
  // Built package entry is used here, matching deployed code, not a second SQL implementation.
  const script = `import { SqliteGrantUseRegistry } from ${JSON.stringify(moduleUrl)};
    const registry = SqliteGrantUseRegistry.open(process.argv[1]);
    try { process.stdout.write(String(registry.consume("grant-multiprocess", 10000, 1))); }
    finally { registry.close(); }`;
  try {
    const outputs = await Promise.all(Array.from({ length: 8 }, () =>
      promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, file])));
    expect(outputs.filter(result => result.stdout === "true")).toHaveLength(1);
    expect(outputs.filter(result => result.stdout === "false")).toHaveLength(7);
  } finally { rmSync(dir, { recursive: true }); }
});
