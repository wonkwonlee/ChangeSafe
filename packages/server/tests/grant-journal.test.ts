import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { GrantJournal } from "../src/grant-journal";

it("grant intent survives restart, is owner-scoped, and cannot be replaced by retry", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "changesafe-intent-"));
  const file = path.join(dir, "journal.db");
  const db = new DatabaseSync(file);
  const first = new GrantJournal(db);
  const intent = { decision: "approve" as const, grant: { authorizedActor: "actor-approved",
    expiresAtUtc: "2026-10-08T10:00:00.000Z" }, issuedAtUtc: "2026-10-08T09:00:00.000Z" };
  expect(first.claim("owner-one/review-one", intent)).toEqual(intent);
  db.close();
  const reopened = new DatabaseSync(file);
  try {
    const journal = new GrantJournal(reopened);
    expect(journal.claim("owner-one/review-one", { ...intent, issuedAtUtc: "2026-10-08T09:01:00.000Z" })).toEqual(intent);
    expect(journal.intent("owner-two/review-one")).toBeNull();
    expect(() => journal.claim("owner-one/review-one", { ...intent, decision: "reject" })).toThrow("immutable");
    expect(() => reopened.exec("UPDATE grant_intents SET payload = '{}'" )).toThrow("immutable");
    expect(() => reopened.exec("DELETE FROM grant_intents" )).toThrow("immutable");
    reopened.exec("INSERT OR REPLACE INTO grant_intents (scope, payload, digest) VALUES ('owner-one/review-one', '{}', 'bad')");
    expect(journal.intent("owner-one/review-one")).toEqual(intent);
    reopened.exec("DROP TRIGGER grant_intents_no_update; UPDATE grant_intents SET payload = '{}'");
    expect(() => journal.intent("owner-one/review-one")).toThrow("integrity mismatch");
  } finally { reopened.close(); rmSync(dir, { recursive: true }); }
});
