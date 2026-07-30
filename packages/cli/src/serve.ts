import { importSigningKeyPair } from "@changesafe/core";
import { Ledger } from "@changesafe/ledger";
import { DecisionService, DurableReviewStore, OidcVerifier, createDecisionServer } from "@changesafe/server";
import type { ApproverPolicy } from "@changesafe/server";

import { UsageError, readTextFile } from "./io";
import { EXIT_OK, paint, type Console } from "./output";
import { SERVER_APP_VERSION } from "./version";

export interface ServeOptions {
  db: string;
  host: string;
  port: number;
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcJwksUri?: string;
  /** Token subjects allowed to act here. Empty means every authenticated one. */
  approvers?: string[];
  /** Claim requirements as `name=value`, e.g. `groups=sre`. */
  approverClaims?: string[];
  signKey?: string;
  /**
   * Durable review queue database. Optional so an operator upgrading in
   * place is not forced onto the queue: without it, `POST /reviews` and
   * `POST /reviews/:id/decisions` do not exist, exactly as before this flag.
   */
  reviewsDb?: string;
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
/** `name=value`, split on the first `=` so a value may contain one. */
function parseClaimRule(raw: string): { name: string; values: string[] } {
  const separator = raw.indexOf("=");
  const name = separator === -1 ? "" : raw.slice(0, separator).trim();
  const value = separator === -1 ? "" : raw.slice(separator + 1).trim();
  if (!name || !value) {
    throw new UsageError(`--approver-claim takes name=value, got "${raw}"`);
  }
  return { name, values: [value] };
}

/** Repeated rules for one claim are alternatives; distinct claims are all required. */
function buildApproverPolicy(options: ServeOptions): ApproverPolicy | undefined {
  const subjects = options.approvers ?? [];
  const rules = (options.approverClaims ?? []).map(parseClaimRule);
  if (subjects.length === 0 && rules.length === 0) return undefined;

  const byName = new Map<string, string[]>();
  for (const rule of rules) {
    byName.set(rule.name, [...(byName.get(rule.name) ?? []), ...rule.values]);
  }
  return {
    ...(subjects.length > 0 ? { subjects } : {}),
    ...(byName.size > 0
      ? { claims: [...byName].map(([name, values]) => ({ name, values })) }
      : {}),
  };
}

function describePolicy(policy: ApproverPolicy): string {
  const parts: string[] = [];
  if (policy.subjects?.length) parts.push(`${policy.subjects.length} subject(s)`);
  for (const claim of policy.claims ?? []) {
    parts.push(`${claim.name} in [${claim.values.join(", ")}]`);
  }
  return parts.join(" and ");
}

export async function runServe(options: ServeOptions, console: Console): Promise<number> {
  if (!options.oidcIssuer || !options.oidcAudience) {
    throw new UsageError(
      "serve needs --oidc-issuer and --oidc-audience. Every decision this API issues names\n" +
        "  an approver, so it will not start without a way to establish who that is.",
    );
  }

  const approverPolicy = buildApproverPolicy(options);

  const ledger = Ledger.open(options.db);
  const reviews = options.reviewsDb ? DurableReviewStore.open(options.reviewsDb) : undefined;
  const signingKeyPair = options.signKey
    ? await importSigningKeyPair(readTextFile(options.signKey, "signing key"))
    : undefined;

  const server = createDecisionServer({
    ledger,
    reviews,
    verifier: new OidcVerifier({
      issuer: options.oidcIssuer,
      audience: options.oidcAudience,
      jwksUri: options.oidcJwksUri,
      approvers: approverPolicy,
    }),
    decisions: new DecisionService({
      ledger,
      appVersion: SERVER_APP_VERSION,
      signingKeyPair,
    }),
  });

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));

  console.out("");
  console.out(`  ${paint(console.color, "bold", "ChangeSafe decision API")}`);
  console.out(`  ${paint(console.color, "dim", `listening on http://${options.host}:${options.port}`)}`);
  console.out(`  ${paint(console.color, "dim", `ledger ${options.db} · ${ledger.count()} entries`)}`);
  console.out(`  ${paint(console.color, "dim", `approvers verified against ${options.oidcIssuer}`)}`);
  // An unrestricted approver list is a real deployment choice, and a quiet one
  // would be indistinguishable from having made no choice at all.
  console.out(
    approverPolicy
      ? `  ${paint(console.color, "dim", `approving restricted to ${describePolicy(approverPolicy)}`)}`
      : `  ${paint(console.color, "yellow", "every identity this issuer vouches for may approve")} ${paint(console.color, "dim", "— pass --approver or --approver-claim to narrow it")}`,
  );
  console.out(
    signingKeyPair
      ? `  ${paint(console.color, "dim", "receipts are signed")}`
      : `  ${paint(console.color, "yellow", "receipts are unsigned")} ${paint(console.color, "dim", "— pass --sign-key to prove authorship")}`,
  );
  console.out(
    reviews
      ? `  ${paint(console.color, "dim", `durable review queue ${options.reviewsDb} · ${reviews.count()} pending`)}`
      : `  ${paint(console.color, "dim", "durable review queue disabled")} ${paint(console.color, "dim", "— pass --reviews-db to accept POST /reviews")}`,
  );
  console.out("");
  console.out(`  ${paint(console.color, "dim", "This API decides and records. It cannot execute a change.")}`);
  console.out("");

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ledger.close();
    reviews?.close();
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
