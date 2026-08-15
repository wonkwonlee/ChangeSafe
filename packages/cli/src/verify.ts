import {
  ChangeReceiptSchema,
  SignedReceiptSchema,
  hashCanonical,
  importVerifyingKey,
  verifyReceiptHash,
  verifyReceiptSignature,
  type ChangeReceipt,
  type ReceiptSignature,
  type SignatureVerdict,
} from "@changesafe/core";

import { resolveDomain } from "./domains";
import { UsageError, parseOrThrow, readJsonFile, readTextFile } from "./io";
import { EXIT_BLOCKED, EXIT_OK, paint, type Console } from "./output";

export interface VerifyOptions {
  receipt: string;
  /** Optional cross-checks: does this receipt describe these artifacts? */
  input?: string;
  proposal?: string;
  /**
   * Untrusted free text that travelled with the original change (a PR body).
   * A domain that folds context into its normalized input (terraform) needs
   * this to reproduce the exact inputSha256 a context-bearing `gate` call
   * produced; omitting it here when the original run used --context makes
   * the input hash check fail even against the correct, untampered input.
   */
  context?: string;
  /** Public-key PEM obtained out of band. Required to check a signature. */
  publicKey?: string;
  /** Explicitly accept an unchecked signature and report integrity only. */
  skipSignature?: boolean;
  domain: string;
  format: "pretty" | "json";
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const SIGNATURE_DETAIL: Record<SignatureVerdict, string> = {
  valid: "signed by the supplied key",
  invalid: "the signature does not match this receipt — it was altered or forged",
  key_mismatch: "signed by a different key than the one supplied",
  unverified: "a signature is present but no trusted key was supplied",
};

/**
 * Split a receipt file into the receipt and its signature, accepting both the
 * bare form and the signed envelope.
 */
function readReceiptFile(raw: unknown): {
  receipt: ChangeReceipt;
  signature: ReceiptSignature | null;
} {
  const isEnvelope = typeof raw === "object" && raw !== null && "receipt" in raw;
  if (isEnvelope) {
    const signed = parseOrThrow(SignedReceiptSchema, raw, "signed receipt");
    return { receipt: signed.receipt, signature: signed.signature };
  }
  return { receipt: parseOrThrow(ChangeReceiptSchema, raw, "receipt"), signature: null };
}

/**
 * Recompute a receipt's hashes, and check its signature when one is present.
 *
 * Hashes prove integrity — that the content still matches what it claims.
 * Only a signature proves authorship, and only against a key obtained out of
 * band. A signed receipt verified without a key therefore exits 2 (could not
 * evaluate) rather than 0: the alternative is a green check that silently
 * skipped the only part that establishes who issued it.
 */
export async function runVerify(options: VerifyOptions, console: Console): Promise<number> {
  const { receipt, signature } = readReceiptFile(readJsonFile(options.receipt, "receipt"));

  if (signature && !options.publicKey && !options.skipSignature) {
    throw new UsageError(
      `this receipt is signed (key id ${signature.publicKeyId}) but no key was supplied to check it.\n` +
        "  Pass --public-key <file.pub.pem> to verify authorship, or --skip-signature to\n" +
        "  check integrity alone and have the signature reported as unverified.",
    );
  }
  if (options.publicKey && !signature) {
    throw new UsageError(
      "--public-key was supplied but this receipt carries no signature. Verifying it would prove nothing about who issued it.",
    );
  }
  if (options.context && !options.input) {
    throw new UsageError(
      "--context was supplied but --input was not. Context only matters as part of the input hash check, so pass --input too.",
    );
  }

  const checks: Check[] = [];
  let parsedInput: unknown | undefined;

  const selfHashOk = await verifyReceiptHash(receipt);
  checks.push({
    name: "receipt hash",
    ok: selfHashOk,
    detail: selfHashOk
      ? "content matches receiptSha256"
      : "content does NOT match receiptSha256 — the receipt was altered",
  });

  let signatureVerdict: SignatureVerdict | null = null;
  if (signature) {
    signatureVerdict = options.publicKey
      ? await verifyReceiptSignature(
          { receipt, signature },
          await importVerifyingKey(readTextFile(options.publicKey, "public key")),
        )
      : "unverified";
    checks.push({
      name: "signature",
      // `unverified` is not a pass; it only avoids failing a run that opted
      // out explicitly, and it is reported as unknown either way.
      ok: signatureVerdict === "valid",
      detail: `${SIGNATURE_DETAIL[signatureVerdict]} (key id ${signature.publicKeyId})`,
    });
  }

  if (options.input) {
    const domain = resolveDomain(options.domain);
    // Text that arrived with the change — a PR body, a commit message — is
    // untrusted data the gate scanned, never instructions it followed; the
    // same treatment applies here, purely to reproduce the hash.
    const context = options.context
      ? [{ kind: "context", text: readTextFile(options.context, "context") }]
      : [];
    const { input, inputId } = domain.parseInput(readJsonFile(options.input, "input"), context);
    parsedInput = input;
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
    const proposalRaw = domain.readProposalFile?.(options.proposal) ?? readJsonFile(options.proposal, "proposal");
    const { proposal } = domain.parseProposal(proposalRaw, parsedInput);
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

  // An explicitly skipped signature must not fail the run, but must never be
  // counted as if it had passed either.
  const failing = checks.filter(
    (check) => !check.ok && !(check.name === "signature" && signatureVerdict === "unverified"),
  );
  const ok = failing.length === 0;

  if (options.format === "json") {
    console.out(
      JSON.stringify(
        {
          ok,
          receiptId: receipt.receiptId,
          signature: signature
            ? { publicKeyId: signature.publicKeyId, verdict: signatureVerdict }
            : null,
          checks,
        },
        null,
        2,
      ),
    );
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
    const unknown = check.name === "signature" && signatureVerdict === "unverified";
    const mark = unknown
      ? paint(console.color, "yellow", "?   ")
      : check.ok
        ? paint(console.color, "green", "ok  ")
        : paint(console.color, "red", "FAIL");
    console.out(`  ${mark}  ${check.name.padEnd(14)} ${paint(console.color, "dim", check.detail)}`);
  }
  console.out("");
  console.out(summary(console, ok, signatureVerdict));
  console.out("");

  return ok ? EXIT_OK : EXIT_BLOCKED;
}

function summary(console: Console, ok: boolean, verdict: SignatureVerdict | null): string {
  if (!ok) return `  ${paint(console.color, "red", "receipt failed verification")}`;
  if (verdict === "valid") {
    return `  ${paint(console.color, "green", "receipt is intact and authentic")} — content matches and the signature is from the supplied key.`;
  }
  if (verdict === "unverified") {
    return `  ${paint(console.color, "yellow", "receipt is internally consistent, authorship unchecked")} — the signature was not verified.`;
  }
  return `  ${paint(console.color, "green", "receipt is internally consistent")} — integrity only; this receipt is unsigned.`;
}
