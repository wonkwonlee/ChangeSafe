import { importSigningKeyPair } from "@changesafe/core";
import { Ledger } from "@changesafe/ledger";
import { DecisionService, OidcVerifier, createDecisionServer } from "@changesafe/server";

import { UsageError, readTextFile } from "./io";
import { EXIT_OK, paint, type Console } from "./output";

export interface ServeOptions {
  db: string;
  host: string;
  port: number;
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcJwksUri?: string;
  signKey?: string;
  /** Resolves once the server is listening; tests use it to stop waiting. */
  onListening?: (close: () => Promise<void>) => void;
}

/**
 * Run the authenticated decision API for a self-hosted deployment.
 *
 * There is no anonymous mode and no `--no-auth` escape hatch. An
 * unauthenticated endpoint that issues approvals would be strictly worse than
 * the browser console it replaces — the console at least never pretends the
 * decision was attributable.
 */
export async function runServe(options: ServeOptions, console: Console): Promise<number> {
  if (!options.oidcIssuer || !options.oidcAudience) {
    throw new UsageError(
      "serve needs --oidc-issuer and --oidc-audience. Every decision this API issues names\n" +
        "  an approver, so it will not start without a way to establish who that is.",
    );
  }

  const ledger = Ledger.open(options.db);
  const signingKeyPair = options.signKey
    ? await importSigningKeyPair(readTextFile(options.signKey, "signing key"))
    : undefined;

  const server = createDecisionServer({
    ledger,
    verifier: new OidcVerifier({
      issuer: options.oidcIssuer,
      audience: options.oidcAudience,
      jwksUri: options.oidcJwksUri,
    }),
    decisions: new DecisionService({
      ledger,
      appVersion: "changesafe-server-0.1.0",
      signingKeyPair,
    }),
  });

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));

  console.out("");
  console.out(`  ${paint(console.color, "bold", "ChangeSafe decision API")}`);
  console.out(`  ${paint(console.color, "dim", `listening on http://${options.host}:${options.port}`)}`);
  console.out(`  ${paint(console.color, "dim", `ledger ${options.db} · ${ledger.count()} entries`)}`);
  console.out(`  ${paint(console.color, "dim", `approvers verified against ${options.oidcIssuer}`)}`);
  console.out(
    signingKeyPair
      ? `  ${paint(console.color, "dim", "receipts are signed")}`
      : `  ${paint(console.color, "yellow", "receipts are unsigned")} ${paint(console.color, "dim", "— pass --sign-key to prove authorship")}`,
  );
  console.out("");
  console.out(`  ${paint(console.color, "dim", "This API decides and records. It cannot execute a change.")}`);
  console.out("");

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ledger.close();
  };

  if (options.onListening) {
    options.onListening(close);
    return EXIT_OK;
  }

  // Run until interrupted, closing the ledger cleanly so WAL state is flushed.
  await new Promise<void>((resolve) => {
    const stop = () => {
      void close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT_OK;
}
