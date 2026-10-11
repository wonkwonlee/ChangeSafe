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
        CREATE TABLE IF NOT EXISTS consumed_grants (grant_id TEXT PRIMARY KEY, expires_at_ms INTEGER NOT NULL, admission_uid TEXT);
        CREATE TRIGGER IF NOT EXISTS consumed_grants_no_replace BEFORE INSERT ON consumed_grants
          WHEN EXISTS (SELECT 1 FROM consumed_grants WHERE grant_id = NEW.grant_id)
          BEGIN SELECT RAISE(IGNORE); END;
        CREATE TRIGGER IF NOT EXISTS consumed_grants_no_update BEFORE UPDATE ON consumed_grants
          BEGIN SELECT RAISE(ABORT, 'immutable grant consumption'); END;
        CREATE TRIGGER IF NOT EXISTS consumed_grants_no_delete BEFORE DELETE ON consumed_grants
          BEGIN SELECT RAISE(ABORT, 'immutable grant consumption'); END;
      `);
      // A file written before admission uids were kept gains the column;
      // its existing rows read back as null ("not recorded"), never as a
      // guessed uid. Adding a column is not an UPDATE, so the immutability
      // triggers neither fire nor need relaxing.
      // Inspect and migrate under one write lock: two enforcers opening the
      // same pre-P2 file during a rolling upgrade must not both see the
      // column missing and both ALTER (the second would fail to start).
      db.exec("BEGIN IMMEDIATE");
      try {
        const columns = db.prepare("PRAGMA table_info(consumed_grants)").all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === "admission_uid")) {
          db.exec("ALTER TABLE consumed_grants ADD COLUMN admission_uid TEXT");
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return new SqliteGrantUseRegistry(db);
    } catch (error) { db.close(); throw error; }
  }

  consume(grantId: string, expiresAtMs: number, nowMs: number, admissionUid: string): boolean {
    z.string().min(1).max(64).parse(grantId);
    z.number().int().finite().parse(expiresAtMs);
    z.number().int().finite().parse(nowMs);
    z.string().min(1).max(255).parse(admissionUid);
    if (nowMs >= expiresAtMs) return false;
    return this.db.prepare(`INSERT INTO consumed_grants (grant_id, expires_at_ms, admission_uid) VALUES (?, ?, ?)
      ON CONFLICT(grant_id) DO NOTHING`).run(grantId, expiresAtMs, admissionUid).changes === 1;
  }

  consumedBy(grantId: string): string | null | undefined {
    const row = this.db.prepare("SELECT admission_uid FROM consumed_grants WHERE grant_id = ?").get(grantId);
    if (row === undefined) return undefined;
    return z.object({ admission_uid: z.string().nullable() }).parse(row).admission_uid;
  }

  close(): void { this.db.close(); }
}
