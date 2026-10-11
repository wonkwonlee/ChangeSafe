import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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
        Promise.resolve().then(() => (index % 2 ? first : second).consume("grant-shared-one", 10000, 1, "adm-grant-shared-one"))));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(first.consume("grant-expired", 10000, 10000, "adm-grant-expired")).toBe(false);
    } finally { first.close(); second.close(); }
    const restarted = SqliteGrantUseRegistry.open(file);
    try { expect(restarted.consume("grant-shared-one", 10000, 2, "adm-grant-shared-one")).toBe(false); }
    finally { restarted.close(); rmSync(dir, { recursive: true }); }
  });
  it("records the consuming admission across restarts, and a replay does not overwrite it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-grants-uid-"));
    const file = path.join(dir, "uses.db");
    const first = SqliteGrantUseRegistry.open(file);
    try {
      expect(first.consumedBy("grant-uid")).toBeUndefined();
      expect(first.consume("grant-uid", 10000, 1, "admission-first")).toBe(true);
    } finally { first.close(); }
    const restarted = SqliteGrantUseRegistry.open(file);
    try {
      expect(restarted.consume("grant-uid", 10000, 2, "admission-replay")).toBe(false);
      expect(restarted.consumedBy("grant-uid")).toBe("admission-first");
    } finally { restarted.close(); rmSync(dir, { recursive: true }); }
  });
  it("migrates a file written before admission uids were kept, without inventing one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "changesafe-grants-legacy-"));
    const file = path.join(dir, "uses.db");
    // The pre-P2 schema, as an enforcer from PR #77 left it on disk.
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE consumed_grants (grant_id TEXT PRIMARY KEY, expires_at_ms INTEGER NOT NULL);
      CREATE TRIGGER consumed_grants_no_update BEFORE UPDATE ON consumed_grants
        BEGIN SELECT RAISE(ABORT, 'immutable grant consumption'); END;
      INSERT INTO consumed_grants VALUES ('grant-legacy', 10000);`);
    legacy.close();
    const registry = SqliteGrantUseRegistry.open(file);
    try {
      expect(registry.consumedBy("grant-legacy")).toBeNull();
      expect(registry.consume("grant-legacy", 10000, 1, "admission-after-upgrade")).toBe(false);
      expect(registry.consumedBy("grant-legacy")).toBeNull();
      expect(registry.consume("grant-new", 10000, 1, "admission-new")).toBe(true);
      expect(registry.consumedBy("grant-new")).toBe("admission-new");
    } finally { registry.close(); }
    const raw = new DatabaseSync(file);
    try {
      expect(() => raw.exec("UPDATE consumed_grants SET admission_uid = 'forged' WHERE grant_id = 'grant-legacy'"))
        .toThrow("immutable grant consumption");
    } finally { raw.close(); rmSync(dir, { recursive: true }); }
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
    try { process.stdout.write(String(registry.consume("grant-multiprocess", 10000, 1, "adm-grant-multiprocess"))); }
    finally { registry.close(); }`;
  try {
    const outputs = await Promise.all(Array.from({ length: 8 }, () =>
      promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, file])));
    expect(outputs.filter(result => result.stdout === "true")).toHaveLength(1);
    expect(outputs.filter(result => result.stdout === "false")).toHaveLength(7);
  } finally { rmSync(dir, { recursive: true }); }
});
