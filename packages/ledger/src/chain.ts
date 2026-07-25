import { hashCanonical } from "@changesafe/core";

/**
 * The hash chain.
 *
 * A table of receipts records what happened. It does not record what was
 * *removed* — an operator who deletes the row for an inconvenient decision
 * leaves a table that still looks perfectly consistent. Linking each entry to
 * the previous one's digest fixes that: deleting, reordering, or editing any
 * entry breaks every link after it, and the break cannot be repaired without
 * rewriting the whole tail.
 *
 * This is tamper *evidence*, not tamper prevention. Someone with write access
 * to the file can rewrite the entire chain. Signing each receipt (see
 * `@changesafe/core`) is what makes that rewrite forgeable-detectable too:
 * they would also need the signing key for every entry they rebuild.
 */

/** Digest that precedes the first entry, so entry 1 has something to link to. */
export const GENESIS_CHAIN_SHA256 = "0".repeat(64);

/**
 * Link one entry to its predecessor.
 *
 * Covers the sequence number as well as the receipt digest, so an entry
 * cannot be moved to a different position in the chain and still verify.
 */
export async function computeChainHash(input: {
  seq: number;
  receiptSha256: string;
  previousChainSha256: string;
}): Promise<string> {
  return hashCanonical({
    seq: input.seq,
    receiptSha256: input.receiptSha256,
    previousChainSha256: input.previousChainSha256,
  });
}
