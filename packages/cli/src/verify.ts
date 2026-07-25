import {
  ChangeReceiptSchema,
  hashCanonical,
  verifyReceiptHash,
} from "@changesafe/core";

import { resolveDomain } from "./domains";
import { parseOrThrow, readJsonFile } from "./io";
import { EXIT_BLOCKED, EXIT_OK, paint, type Console } from "./output";

export interface VerifyOptions {
  receipt: string;
  /** Optional cross-checks: does this receipt describe these artifacts? */
  input?: string;
  proposal?: string;
  domain: string;
  format: "pretty" | "json";
}

/**
 * Recompute a receipt's hashes and report whether it still describes what it
 * claims. This proves integrity, not authorship — receipts are unsigned in
 * this version, so a party with the codebase can produce a consistent one.
 */
export async function runVerify(options: VerifyOptions, console: Console): Promise<number> {
  const receipt = parseOrThrow(
    ChangeReceiptSchema,
    readJsonFile(options.receipt, "receipt"),
    "receipt",
  );

  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const selfHashOk = await verifyReceiptHash(receipt);
  checks.push({
    name: "receipt hash",
    ok: selfHashOk,
    detail: selfHashOk
      ? "content matches receiptSha256"
      : "content does NOT match receiptSha256 — the receipt was altered",
  });

  if (options.input) {
    const domain = resolveDomain(options.domain);
    const { input, inputId } = domain.parseInput(readJsonFile(options.input, "input"));
    const actual = await hashCanonical(input);
    checks.push({
      name: "input hash",
      ok: actual === receipt.inputSha256,
      detail:
        actual === receipt.inputSha256
          ? `matches inputSha256 (${inputId})`
          : "the supplied input is not what this receipt describes",
    });
  }

  if (options.proposal) {
    const domain = resolveDomain(options.domain);
    const { proposal } = domain.parseProposal(readJsonFile(options.proposal, "proposal"));
    const actual = await hashCanonical(proposal);
    checks.push({
      name: "proposal hash",
      ok: actual === receipt.proposalSha256,
      detail:
        actual === receipt.proposalSha256
          ? "matches proposalSha256"
          : "the supplied proposal is not what this receipt describes",
    });
  }

  const ok = checks.every((check) => check.ok);

  if (options.format === "json") {
    console.out(JSON.stringify({ ok, receiptId: receipt.receiptId, checks }, null, 2));
    return ok ? EXIT_OK : EXIT_BLOCKED;
  }

  console.out("");
  console.out(
    `  ${paint(console.color, "bold", "ChangeSafe receipt")} ${paint(
      console.color,
      "dim",
      `· ${receipt.receiptId}`,
    )}`,
  );
  console.out(
    `  ${paint(console.color, "dim", `decision ${receipt.decision} · risk ${receipt.riskLevel} · mode ${receipt.mode} · policies ${receipt.policyVersion}`)}`,
  );
  console.out("");
  for (const check of checks) {
    const mark = check.ok
      ? paint(console.color, "green", "ok  ")
      : paint(console.color, "red", "FAIL");
    console.out(`  ${mark}  ${check.name.padEnd(14)} ${paint(console.color, "dim", check.detail)}`);
  }
  console.out("");
  console.out(
    ok
      ? `  ${paint(console.color, "green", "receipt is internally consistent")} — integrity only; receipts are unsigned.`
      : `  ${paint(console.color, "red", "receipt failed verification")}`,
  );
  console.out("");

  return ok ? EXIT_OK : EXIT_BLOCKED;
}
