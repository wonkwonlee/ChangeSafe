/**
 * @changesafe/ledger — an append-only receipt ledger.
 *
 * A self-hoster needs to answer "what did this gate decide, and when" months
 * later, to someone who was not there. That needs durable storage where the
 * absence of a record is as detectable as its alteration — otherwise the
 * easiest way to hide an inconvenient decision is to delete it.
 *
 * SQLite through `node:sqlite`, so this costs no dependency and no native
 * build step. Append-only is enforced by database triggers; a hash chain
 * makes deletion, reordering, and direct file edits detectable after the
 * fact. Nothing here can influence a verdict — the ledger only records.
 */

export { GENESIS_CHAIN_SHA256, computeChainHash } from "./chain";
export { Ledger, LedgerCorruptionError } from "./ledger";
export type {
  ChainBreak,
  ChainVerdict,
  LedgerEntry,
  LedgerRecord,
  ListOptions,
} from "./ledger";
