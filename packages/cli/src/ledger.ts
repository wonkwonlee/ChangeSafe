import { ChangeReceiptSchema, SignedReceiptSchema } from "@changesafe/core";
import { Ledger, type LedgerRecord } from "@changesafe/ledger";

import { UsageError, parseOrThrow, readJsonFile } from "./io";
import { EXIT_BLOCKED, EXIT_OK, paint, type Console } from "./output";

export interface LedgerOptions {
  db: string;
  receipt?: string;
  sourceId?: string;
  decision?: string;
  limit?: number;
  format: "pretty" | "json";
}

function parseRecordFile(raw: unknown): LedgerRecord {
  const isEnvelope = typeof raw === "object" && raw !== null && "receipt" in raw;
  return isEnvelope
    ? parseOrThrow(SignedReceiptSchema, raw, "signed receipt")
    : parseOrThrow(ChangeReceiptSchema, raw, "receipt");
}

/** Record a receipt in the append-only ledger. */
export async function runLedgerAppend(
  options: LedgerOptions,
  console: Console,
): Promise<number> {
  if (!options.receipt) {
    throw new UsageError("ledger append needs a receipt: changesafe ledger append <receipt.json>");
  }
  const record = parseRecordFile(readJsonFile(options.receipt, "receipt"));

  const ledger = Ledger.open(options.db);
  try {
    const entry = await ledger.append(record);
    if (options.format === "json") {
      console.out(
        JSON.stringify(
          { seq: entry.seq, receiptId: entry.receiptId, chainSha256: entry.chainSha256 },
          null,
          2,
        ),
      );
      return EXIT_OK;
    }
    console.out("");
    console.out(
      `  ${paint(console.color, "green", "recorded")} ${paint(console.color, "dim", `#${entry.seq} · ${entry.receiptId} · ${entry.decision}`)}`,
    );
    console.out(`  ${paint(console.color, "dim", `chain head now ${entry.chainSha256}`)}`);
    console.out("");
    return EXIT_OK;
  } finally {
    ledger.close();
  }
}

/** List recorded decisions, newest first. */
export function runLedgerList(options: LedgerOptions, console: Console): number {
  const ledger = Ledger.open(options.db);
  try {
    const entries = ledger.list({
      limit: options.limit,
      sourceId: options.sourceId,
      decision: options.decision,
    });

    if (options.format === "json") {
      console.out(
        JSON.stringify(
          entries.map((entry) => ({
            seq: entry.seq,
            receiptId: entry.receiptId,
            createdAtUtc: entry.createdAtUtc,
            decision: entry.decision,
            riskLevel: entry.riskLevel,
            sourceId: entry.sourceId,
            signatureKeyId: entry.signatureKeyId,
            chainSha256: entry.chainSha256,
          })),
          null,
          2,
        ),
      );
      return EXIT_OK;
    }

    console.out("");
    if (entries.length === 0) {
      console.out(`  ${paint(console.color, "dim", "no decisions recorded yet")}`);
      console.out("");
      return EXIT_OK;
    }
    for (const entry of entries) {
      const decision =
        entry.decision === "blocked"
          ? paint(console.color, "red", entry.decision.padEnd(9))
          : entry.decision === "approved"
            ? paint(console.color, "green", entry.decision.padEnd(9))
            : paint(console.color, "dim", entry.decision.padEnd(9));
      const signed = entry.signatureKeyId
        ? paint(console.color, "dim", ` signed:${entry.signatureKeyId.slice(0, 8)}`)
        : paint(console.color, "dim", " unsigned");
      console.out(
        `  ${String(entry.seq).padStart(4)}  ${entry.createdAtUtc}  ${decision}  ${entry.sourceId}${signed}`,
      );
    }
    console.out("");
    return EXIT_OK;
  } finally {
    ledger.close();
  }
}

/**
 * Recompute the whole chain.
 *
 * Exits 1 on any break. A ledger that cannot prove its own continuity is a
 * finding, not a warning — the entire reason to keep one is to be able to say
 * later that nothing was quietly removed.
 */
export async function runLedgerVerify(
  options: LedgerOptions,
  console: Console,
): Promise<number> {
  const ledger = Ledger.open(options.db);
  try {
    const verdict = await ledger.verifyChain();

    if (options.format === "json") {
      console.out(JSON.stringify(verdict, null, 2));
      return verdict.ok ? EXIT_OK : EXIT_BLOCKED;
    }

    console.out("");
    console.out(
      `  ${paint(console.color, "bold", "ChangeSafe ledger")} ${paint(console.color, "dim", `· ${options.db} · ${verdict.entries} entries`)}`,
    );
    console.out("");
    if (verdict.ok) {
      console.out(`  ${paint(console.color, "green", "chain intact")} — no entry was altered, removed, or reordered.`);
      if (verdict.headChainSha256) {
        console.out(`  ${paint(console.color, "dim", `head ${verdict.headChainSha256}`)}`);
        console.out(
          `  ${paint(console.color, "dim", "Record this head somewhere else to detect a later rewrite of the whole chain.")}`,
        );
      }
    } else {
      console.out(`  ${paint(console.color, "red", "chain broken")}`);
      for (const brk of verdict.breaks) {
        console.out(`    ${paint(console.color, "red", `#${brk.seq}`)} ${brk.receiptId}`);
        console.out(`      ${paint(console.color, "dim", brk.reason)}`);
      }
    }
    console.out("");
    return verdict.ok ? EXIT_OK : EXIT_BLOCKED;
  } finally {
    ledger.close();
  }
}
