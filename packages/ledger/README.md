# @changesafe/ledger

An append-only receipt ledger, so a decision that was made can still be shown
months later — and one that was quietly removed cannot hide.

```bash
changesafe gate --scenario ./change --receipt r.json --sign-key key.pem
changesafe ledger append r.json --db decisions.db
changesafe ledger list   --db decisions.db
changesafe ledger verify --db decisions.db     # exits 1 on any break
```

SQLite through `node:sqlite`, which ships with Node — durable storage with no
dependency, no native build step, and no server process to run.

## Why a chain and not just a table

A table of receipts records what happened. It does not record what was
*removed*: delete the row for an inconvenient decision and the remaining rows
are individually perfect, the listing looks clean, and nothing indicates the
gap.

Each entry therefore links to the previous entry's digest. Deleting,
reordering, or editing an entry breaks every link after it, and the break
cannot be repaired without rewriting the whole tail.

```
genesis ──▶ #1 ──▶ #2 ──▶ #3 ──▶ head
                    ✗ delete #2 and #3 no longer links to anything
```

`verify` recomputes the chain from genesis and reports each break with its
cause: a sequence gap, an entry that does not link to its predecessor, a
rewritten digest, or stored content that no longer matches the digest the
chain recorded.

## Two layers, doing different jobs

**Append-only triggers** — `UPDATE` and `DELETE` on the receipts table abort
inside SQLite. This is enforcement where the data lives, not a convention
application code could bypass, and it stops the ordinary accident: a stray
statement, a well-meaning cleanup script, a second tool pointed at the file.

**The hash chain** — evidence, for the case the triggers cannot cover.
Someone who owns the file can drop the triggers. They cannot make the chain
agree afterwards.

Signing each receipt raises that bar further: rebuilding a chain from scratch
also means producing a valid signature for every entry, which needs the
private key. The ledger records which key signed each entry, or that it was
unsigned.

## What it deliberately does not do

- **It cannot influence a verdict.** Nothing here participates in gating; the
  ledger only records what was already decided.
- **It does not prevent tampering, it makes tampering evident.** A determined
  operator with write access can rewrite the whole file. Publishing the chain
  head somewhere else — a log, a ticket, another system — is what turns that
  from "possible" into "visible", and `verify` prints the head for exactly
  that purpose.
- **It stores no secrets.** Receipts contain findings and hashes, never
  credentials or raw model text.

## API

```ts
import { Ledger } from "@changesafe/ledger";

const ledger = Ledger.open("decisions.db");   // ":memory:" in tests
await ledger.append(receiptOrSignedEnvelope); // rejects a duplicate receiptId
ledger.list({ sourceId, decision, limit });   // newest first
const verdict = await ledger.verifyChain();   // { ok, entries, headChainSha256, breaks }
ledger.close();
```

Rows are parsed with a schema on the way out rather than asserted: the
database file is a boundary input, and for a feature whose purpose is
detecting tampering, trusting its shape on faith would be the wrong instinct.

`append` is safe to call concurrently. Deciding the next entry means reading
the chain head and then hashing, and hashing is asynchronous — so two
decisions arriving together would otherwise build the same link and the
second would land on the sequence number the first just took. Appends queue
behind each other instead, which costs microseconds and turns a collision
into an ordering. Two *processes* writing the same file are still caught by
the primary key rather than by that queue; a ledger is meant to have one
writer.

## License

MIT — see the repository root.
