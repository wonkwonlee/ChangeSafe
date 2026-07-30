import type { SelfHostedReviewSummary } from "@/features/reviews/selfHostedReviewTransport";

export function SelfHostedReviewQueue({
  reviews,
  selectedReviewId,
  onSelect,
}: {
  reviews: readonly SelfHostedReviewSummary[];
  selectedReviewId: string | null;
  onSelect: (reviewId: string) => void;
}) {
  if (reviews.length === 0) {
    return (
      <div className="mt-4 rounded border border-edge bg-canvas p-4" role="status">
        <p className="text-sm font-medium">No authenticated reviews</p>
        <p className="mt-1 text-xs text-ink-dim">
          Add a bundled offline artifact to create an immutable pending record.
        </p>
      </div>
    );
  }
  return (
    <ul aria-label="Authenticated review queue" className="mt-4 grid gap-2" role="list">
      {reviews.map((review) => (
        <li key={`${review.reviewId}-${review.seq}`}>
          <button
            aria-pressed={review.reviewId === selectedReviewId}
            className="w-full rounded border border-edge px-3 py-3 text-left hover:border-active"
            onClick={() => onSelect(review.reviewId)}
            type="button"
          >
            <span className="block text-sm font-medium">{review.inputId}</span>
            <span className="mt-1 block text-xs text-ink-dim">
              {review.domainId} · {review.createdAtUtc}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
