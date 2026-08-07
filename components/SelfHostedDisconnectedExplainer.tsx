import type { ReceiptProof } from "@/features/reviews/durable-review-contract";

import { SelfHostedReceiptProof } from "./SelfHostedReceiptProof";

/**
 * A schema-shaped but entirely fictional receipt proof, used only to show
 * what the claims section looks like once populated. Every value is
 * obviously synthetic (repeated-digit hashes, an example.invalid issuer) and
 * the panel that renders it is permanently labeled "Example" — this must
 * never be mistaken for a real review, per the project's provenance-honesty
 * invariant.
 */
export const EXAMPLE_RECEIPT_PROOF: ReceiptProof = {
  reviewId: "review-example-0000000000000000",
  receiptId: "receipt-example-0000000000000000",
  receiptSha256: "e".repeat(64),
  contentIntegrity: { status: "verified", checkedAtUtc: "2026-01-01T00:00:00.000Z" },
  signature: { present: true, publicKeyId: "a".repeat(32) },
  outOfBandVerification: {
    status: "valid",
    trustedPublicKeyId: "a".repeat(32),
    checkedAtUtc: "2026-01-01T00:00:00.000Z",
  },
  ledgerInclusion: {
    status: "included",
    sequence: 42,
    chainSha256: "b".repeat(64),
    checkedAtUtc: "2026-01-01T00:00:00.000Z",
  },
  ledgerChain: {
    status: "verified",
    headChainSha256: "c".repeat(64),
    checkedAtUtc: "2026-01-01T00:00:00.000Z",
  },
};

const VALUE_PROPS: { readonly title: string; readonly detail: string }[] = [
  {
    title: "OIDC approver identity",
    detail: "A decision is bound to a real signed-in issuer and subject, not an anonymous click in a browser.",
  },
  {
    title: "Server-recomputed findings",
    detail: "Policies are re-evaluated on every read from the server, so the UI can never show a stale or spoofed verdict.",
  },
  {
    title: "Signed receipts",
    detail: "Every decision is written as an Ed25519-signed receipt, checkable out of band against a public key you control.",
  },
  {
    title: "Ledger inclusion",
    detail: "Receipts append to a hash-chained ledger; a removed, altered, or reordered entry is detectable, not just implied.",
  },
];

/**
 * Replaces the three-pane app shell when no self-hosted gateway is
 * configured. The disabled shell used to render regardless — every control
 * present but dead — which read as a broken deploy rather than a deliberate
 * public state. This explains what self-hosting adds instead of asking the
 * visitor to operate a queue that can never hold anything.
 */
export function SelfHostedDisconnectedExplainer() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="self-hosted-value-title" className="rounded-xl border border-edge bg-surface p-5">
        <p className="eyebrow text-ink-faint">What self-hosting adds</p>
        <h2 className="mt-2 text-lg font-semibold" id="self-hosted-value-title">
          Beyond public replay
        </h2>
        <dl className="mt-4 grid gap-4">
          {VALUE_PROPS.map((item) => (
            <div key={item.title}>
              <dt className="text-sm font-medium text-ink">{item.title}</dt>
              <dd className="mt-1 text-sm text-ink-dim">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="self-hosted-example-title" className="rounded-xl border border-dashed border-edge bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow text-ink-faint">What a resolved review looks like</p>
            <h2 className="mt-2 text-lg font-semibold" id="self-hosted-example-title">
              Independent receipt proof
            </h2>
          </div>
          <span className="rounded border border-warn/50 bg-warn/10 px-2 py-1 text-xs font-semibold text-warn">
            Example
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Fictional claims for illustration only — not a real review, not signed by any key.
        </p>
        <SelfHostedReceiptProof proof={EXAMPLE_RECEIPT_PROOF} />
      </section>
    </div>
  );
}
