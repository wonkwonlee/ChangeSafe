import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { DomainError, SignedGrantSchema, TimestampSchema, canonicalize, type SignedGrant } from "@changesafe/core";
import { GrantPreferencesSchema } from "./grant-binding";

const IntentSchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  grant: GrantPreferencesSchema.nullable(),
  issuedAtUtc: TimestampSchema,
});
type Intent = z.infer<typeof IntentSchema>;
const RowSchema = z.object({ payload: z.string(), digest: z.string() });
const digestOf = (payload: string) => createHash("sha256").update(payload).digest("hex");

/** Separate authority records; ChangeReceipt remains evidence, never a capability. */
export class GrantJournal {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grant_intents (scope TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS issued_grants (scope TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS grant_intents_no_replace BEFORE INSERT ON grant_intents
        WHEN EXISTS (SELECT 1 FROM grant_intents WHERE scope = NEW.scope)
        BEGIN SELECT RAISE(IGNORE); END;
      CREATE TRIGGER IF NOT EXISTS issued_grants_no_replace BEFORE INSERT ON issued_grants
        WHEN EXISTS (SELECT 1 FROM issued_grants WHERE scope = NEW.scope)
        BEGIN SELECT RAISE(IGNORE); END;
      CREATE TRIGGER IF NOT EXISTS grant_intents_no_update BEFORE UPDATE ON grant_intents BEGIN SELECT RAISE(ABORT, 'immutable grant intent'); END;
      CREATE TRIGGER IF NOT EXISTS grant_intents_no_delete BEFORE DELETE ON grant_intents BEGIN SELECT RAISE(ABORT, 'immutable grant intent'); END;
      CREATE TRIGGER IF NOT EXISTS issued_grants_no_update BEFORE UPDATE ON issued_grants BEGIN SELECT RAISE(ABORT, 'immutable issued grant'); END;
      CREATE TRIGGER IF NOT EXISTS issued_grants_no_delete BEFORE DELETE ON issued_grants BEGIN SELECT RAISE(ABORT, 'immutable issued grant'); END;
    `);
  }

  intent(scope: string): Intent | null {
    const raw = this.read("grant_intents", scope);
    return raw === null ? null : IntentSchema.parse(raw);
  }

  claim(scope: string, raw: Intent): Intent {
    const intent = IntentSchema.parse(raw);
    this.insert("grant_intents", scope, intent);
    const stored = this.intent(scope)!;
    // A retry may have a later clock; authority preferences and human intent cannot change.
    if (canonicalize({ ...stored, issuedAtUtc: "" }) !== canonicalize({ ...intent, issuedAtUtc: "" })) {
      throw new DomainError("ILLEGAL_TRANSITION", "Review already has different immutable grant intent.");
    }
    return stored;
  }

  grant(scope: string): SignedGrant | null {
    const raw = this.read("issued_grants", scope);
    return raw === null ? null : SignedGrantSchema.parse(raw);
  }

  record(scope: string, raw: SignedGrant): SignedGrant {
    const signed = SignedGrantSchema.parse(raw);
    const intent = this.intent(scope);
    if (!intent?.grant || intent.decision !== "approve") {
      throw new DomainError("ILLEGAL_TRANSITION", "No approved grant intent exists.");
    }
    this.insert("issued_grants", scope, signed);
    const stored = this.grant(scope)!;
    if (canonicalize(stored.grant) !== canonicalize(signed.grant)) {
      throw new DomainError("ILLEGAL_TRANSITION", "Review already has a different issued grant.");
    }
    return stored;
  }

  private read(table: "grant_intents" | "issued_grants", scope: string): unknown | null {
    const raw = this.db.prepare(`SELECT payload, digest FROM ${table} WHERE scope = ?`).get(scope);
    if (!raw) return null;
    const row = RowSchema.parse(raw);
    if (digestOf(row.payload) !== row.digest) throw new DomainError("INTERNAL", "Grant journal integrity mismatch.");
    return JSON.parse(row.payload) as unknown;
  }

  private insert(table: "grant_intents" | "issued_grants", scope: string, value: unknown): void {
    const payload = canonicalize(value);
    // UNIQUE scope makes first issuance authoritative across processes. Never REPLACE.
    this.db.prepare(`INSERT INTO ${table} (scope, payload, digest) VALUES (?, ?, ?) ON CONFLICT(scope) DO NOTHING`)
      .run(scope, payload, digestOf(payload));
  }
}
