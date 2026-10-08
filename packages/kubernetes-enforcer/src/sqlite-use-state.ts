import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { GrantUseRegistry } from "./use-state";

/** One shared file on a filesystem with reliable SQLite locking; not per-replica copies. */
export class SqliteGrantUseRegistry implements GrantUseRegistry {
  private constructor(private readonly db: DatabaseSync) {}

  static open(filename: string): SqliteGrantUseRegistry {
    if (filename === ":memory:" || !filename) throw new Error("Persistent grant-use database required");
    const db = new DatabaseSync(filename);
    try {
      db.exec(`PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS consumed_grants (grant_id TEXT PRIMARY KEY, expires_at_ms INTEGER NOT NULL);
        CREATE TRIGGER IF NOT EXISTS consumed_grants_no_replace BEFORE INSERT ON consumed_grants
          WHEN EXISTS (SELECT 1 FROM consumed_grants WHERE grant_id = NEW.grant_id)
          BEGIN SELECT RAISE(IGNORE); END;
        CREATE TRIGGER IF NOT EXISTS consumed_grants_no_update BEFORE UPDATE ON consumed_grants
          BEGIN SELECT RAISE(ABORT, 'immutable grant consumption'); END;
        CREATE TRIGGER IF NOT EXISTS consumed_grants_no_delete BEFORE DELETE ON consumed_grants
          BEGIN SELECT RAISE(ABORT, 'immutable grant consumption'); END;
      `);
      return new SqliteGrantUseRegistry(db);
    } catch (error) { db.close(); throw error; }
  }

  consume(grantId: string, expiresAtMs: number, nowMs: number): boolean {
    z.string().min(1).max(64).parse(grantId);
    z.number().int().finite().parse(expiresAtMs);
    z.number().int().finite().parse(nowMs);
    if (nowMs >= expiresAtMs) return false;
    return this.db.prepare(`INSERT INTO consumed_grants (grant_id, expires_at_ms) VALUES (?, ?)
      ON CONFLICT(grant_id) DO NOTHING`).run(grantId, expiresAtMs).changes === 1;
  }

  close(): void { this.db.close(); }
}
