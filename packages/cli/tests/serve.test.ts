import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FakeIdp } from "../../server/tests/helpers";
import { runServe, type ServeOptions } from "../src/serve";
import type { Console } from "../src/output";

function silentConsole(): Console {
  return { out: () => {}, err: () => {}, color: false };
}

function temporaryDbDir(): { db: string; reviewsDb: string; remove(): void } {
  const directory = mkdtempSync(path.join(tmpdir(), "changesafe-cli-serve-"));
  return {
    db: path.join(directory, "ledger.db"),
    reviewsDb: path.join(directory, "reviews.db"),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

let nextPort = 41200;

/** Starts `runServe` on a fixed local port and resolves once it is listening. */
async function startServer(
  options: Omit<ServeOptions, "port" | "onListening">,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const port = nextPort++;
  const close = await new Promise<() => Promise<void>>((resolve) => {
    void runServe(
      { ...options, port, onListening: resolve },
      silentConsole(),
    );
  });
  return { baseUrl: `http://${options.host}:${port}`, close };
}

describe("changesafe serve — durable review queue wiring", () => {
  let cleanupPaths: (() => void) | undefined;
  let stopServer: (() => Promise<void>) | undefined;
  let restoreFetch: (() => void) | undefined;

  afterEach(async () => {
    await stopServer?.();
    stopServer = undefined;
    cleanupPaths?.();
    cleanupPaths = undefined;
    restoreFetch?.();
    restoreFetch = undefined;
  });

  it("leaves the durable review queue absent without --reviews-db", async () => {
    const idp = await FakeIdp.create();
    const paths = temporaryDbDir();
    cleanupPaths = paths.remove;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = idp.fetch();
    restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    const { baseUrl, close } = await startServer({
      db: paths.db,
      host: "127.0.0.1",
      oidcIssuer: idp.issuer,
      oidcAudience: "changesafe",
    });
    stopServer = close;

    const token = await idp.token({ aud: "changesafe" });
    // The idp's fake fetch only answers discovery/jwks URLs; the request to
    // the server under test must bypass it and use the real network stack.
    const response = await originalFetch(`${baseUrl}/reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(404);
  });

  it("accepts durable review intake once --reviews-db is passed", async () => {
    const idp = await FakeIdp.create();
    const paths = temporaryDbDir();
    cleanupPaths = paths.remove;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = idp.fetch();
    restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    const { baseUrl, close } = await startServer({
      db: paths.db,
      host: "127.0.0.1",
      oidcIssuer: idp.issuer,
      oidcAudience: "changesafe",
      reviewsDb: paths.reviewsDb,
    });
    stopServer = close;

    const token = await idp.token({ aud: "changesafe" });
    // A malformed body is enough to prove the route exists: it must be
    // rejected by schema validation (400-class), never treated as unknown
    // (404) the way it is without --reviews-db.
    const response = await originalFetch(`${baseUrl}/reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).not.toBe(404);
  });
});
