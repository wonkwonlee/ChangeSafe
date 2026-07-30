import type { SelfHostedReviewEntry } from "@/features/reviews/selfHostedReviewTransport";
import type {
  ReceiptProofViewState,
  ReviewResolutionStatus,
} from "@/features/reviews/selfHostedReviewViewState";

import { SelfHostedReceiptProof } from "./SelfHostedReceiptProof";

export function SelfHostedReviewDetail({
  review,
  proof,
  resolutionStatus,
  busy,
  actionMessage,
  onDecide,
}: {
  review: SelfHostedReviewEntry | null;
  proof: ReceiptProofViewState;
  resolutionStatus: ReviewResolutionStatus;
  busy: boolean;
  actionMessage: string | null;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  if (!review) {
    return (
      <div className="rounded-lg border border-edge bg-raised p-5" role="status">
        <h2 className="text-base font-semibold">Select a durable review</h2>
        <p className="mt-2 text-sm text-ink-dim">
          Detail, human decision controls, and receipt proof stay owner-scoped.
        </p>
      </div>
    );
  }
  const pending = resolutionStatus === "pending";
  const statusLabel =
    resolutionStatus === "pending"
      ? "Pending human decision"
      : resolutionStatus === "resolved"
        ? "Resolved · receipt issued"
        : "Resolution status unavailable";
  return (
    <article aria-busy={busy} className="rounded-lg border border-edge bg-raised p-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge pb-4">
        <div>
          <p className="eyebrow text-ink-faint">{review.domainId} durable review</p>
          <h2 className="mt-2 text-lg font-semibold">{review.inputId}</h2>
          <p className="mt-1 font-mono text-xs text-ink-dim">{review.reviewId}</p>
        </div>
        <span className="rounded border border-edge px-2 py-1 text-xs font-semibold">
          {statusLabel}
        </span>
      </header>

      <section className="mt-4" aria-labelledby="artifact-title">
        <h3 id="artifact-title" className="text-sm font-semibold">Immutable offline artifact</h3>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-ink-faint">Source</dt><dd className="mt-1">{review.sourceId}</dd></div>
          <div><dt className="text-ink-faint">Provenance</dt><dd className="mt-1">{review.record.intake.source.origin}</dd></div>
          <div><dt className="text-ink-faint">Policy version</dt><dd className="mt-1 font-mono">{review.record.session.policyVersion}</dd></div>
          <div><dt className="text-ink-faint">Input SHA-256</dt><dd className="mt-1 break-all font-mono">{review.record.intake.input.inputSha256}</dd></div>
        </dl>
      </section>

      <section className="mt-5 border-t border-edge pt-4" aria-labelledby="human-decision-title">
        <h3 id="human-decision-title" className="text-sm font-semibold">Authenticated human decision</h3>
        {pending ? (
          <>
            <p className="mt-2 text-sm text-ink-dim">
              The server recomputes policy findings and risk. BLOCK remains unapprovable.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded bg-active px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => onDecide("approve")} type="button">Approve</button>
              <button className="rounded border border-edge px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={() => onDecide("reject")} type="button">Reject</button>
            </div>
          </>
        ) : resolutionStatus === "resolved" ? (
          <p className="mt-2 text-sm text-ink-dim">The immutable resolution has already been written.</p>
        ) : (
          <p className="mt-2 text-sm text-ink-dim">
            Decision controls remain disabled until the server confirms that this review is pending.
          </p>
        )}
        {actionMessage ? <p className="mt-3 rounded border border-warn/50 bg-warn/10 p-3 text-sm text-warn" role="status">{actionMessage}</p> : null}
      </section>

      <section className="mt-5 border-t border-edge pt-4" aria-labelledby="proof-title">
        <h3 id="proof-title" className="text-sm font-semibold">Receipt proof</h3>
        {proof.status === "available" ? (
          <SelfHostedReceiptProof proof={proof.proof} />
        ) : proof.status === "loading" ? (
          <p className="mt-2 text-sm text-ink-dim">Loading receipt proof evidence.</p>
        ) : proof.status === "unavailable" ? (
          <p className="mt-2 text-sm text-ink-dim">
            Receipt proof is unavailable. This does not change the review resolution state.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-dim">
            Not created. A pending review has no signed receipt or ledger inclusion claim.
          </p>
        )}
      </section>

      <section className="mt-5 border-t border-edge pt-4" aria-labelledby="execution-boundary-title">
        <h3 id="execution-boundary-title" className="text-sm font-semibold">Execution boundary</h3>
        <p className="mt-2 text-sm text-ink-dim">
          No infrastructure action exists here. ChangeSafe analyzes, gates, records, and stops.
        </p>
      </section>
    </article>
  );
}
