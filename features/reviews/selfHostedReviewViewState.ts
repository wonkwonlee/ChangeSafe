import type { ReceiptProof } from "./durable-review-contract";
import type {
  SelfHostedReviewEntry,
  SelfHostedReviewProjection,
} from "./selfHostedReviewTransport";

export type ReviewResolutionStatus = "unknown" | "pending" | "resolved";

export type ReceiptProofViewState =
  | { readonly status: "loading" }
  | { readonly status: "not-created" }
  | { readonly status: "unavailable" }
  | { readonly status: "available"; readonly proof: ReceiptProof };

export interface ReviewAttempt {
  readonly token: number;
  readonly reviewId: string;
  readonly kind: "create" | "select" | "decide";
}

export interface SelfHostedReviewViewState {
  readonly targetReviewId: string | null;
  readonly review: SelfHostedReviewEntry | null;
  /**
   * Server-recomputed findings and risk for the selected review, or null when
   * none has been read yet. Never derived in the browser: a projection the
   * client computed would not be the verdict the server will enforce.
   */
  readonly projection: SelfHostedReviewProjection | null;
  readonly resolutionStatus: ReviewResolutionStatus;
  readonly proof: ReceiptProofViewState;
  readonly activeAttempt: ReviewAttempt | null;
  readonly message: string | null;
}

export const INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE: SelfHostedReviewViewState = {
  targetReviewId: null,
  review: null,
  projection: null,
  resolutionStatus: "unknown",
  proof: { status: "not-created" },
  activeAttempt: null,
  message: null,
};

export type SelfHostedReviewViewAction =
  | { readonly type: "begin"; readonly attempt: ReviewAttempt }
  | {
      readonly type: "selected";
      readonly attempt: ReviewAttempt;
      readonly review: SelfHostedReviewEntry;
      readonly projection: SelfHostedReviewProjection;
      readonly resolutionStatus: ReviewResolutionStatus;
      readonly proof: ReceiptProofViewState;
      readonly message?: string;
    }
  | {
      readonly type: "created";
      readonly attempt: ReviewAttempt;
      readonly review: SelfHostedReviewEntry;
    }
  | { readonly type: "decision-resolved"; readonly attempt: ReviewAttempt }
  | {
      readonly type: "proof-completed";
      readonly attempt: ReviewAttempt;
      readonly proof: ReceiptProofViewState;
      readonly message?: string;
    }
  | {
      readonly type: "failed";
      readonly attempt: ReviewAttempt;
      readonly message: string;
    }
  | { readonly type: "finish"; readonly attempt: ReviewAttempt };

function isCurrentAttempt(
  state: SelfHostedReviewViewState,
  attempt: ReviewAttempt,
): boolean {
  return (
    state.activeAttempt?.token === attempt.token &&
    state.activeAttempt.reviewId === attempt.reviewId &&
    state.activeAttempt.kind === attempt.kind
  );
}

export function selfHostedReviewViewReducer(
  state: SelfHostedReviewViewState,
  action: SelfHostedReviewViewAction,
): SelfHostedReviewViewState {
  if (action.type === "begin") {
    if (action.attempt.kind === "decide") {
      return {
        ...state,
        targetReviewId: action.attempt.reviewId,
        activeAttempt: action.attempt,
        message: null,
      };
    }
    return {
      targetReviewId: action.attempt.reviewId,
      review: null,
      projection: null,
      resolutionStatus: "unknown",
      proof: { status: "loading" },
      activeAttempt: action.attempt,
      message: null,
    };
  }

  if (!isCurrentAttempt(state, action.attempt)) {
    return state;
  }

  switch (action.type) {
    case "selected":
      return {
        ...state,
        targetReviewId: action.review.reviewId,
        review: action.review,
        projection: action.projection,
        resolutionStatus: action.resolutionStatus,
        proof: action.proof,
        message: action.message ?? null,
      };
    case "created":
      return {
        ...state,
        targetReviewId: action.review.reviewId,
        review: action.review,
        // A freshly queued review has not been read back, so no server
        // recomputation exists for it yet. Claiming one would be an invention.
        projection: null,
        resolutionStatus: "pending",
        proof: { status: "not-created" },
      };
    case "decision-resolved":
      return {
        ...state,
        resolutionStatus: "resolved",
        proof: { status: "loading" },
      };
    case "proof-completed":
      return {
        ...state,
        proof: action.proof,
        message: action.message ?? null,
      };
    case "failed":
      return {
        ...state,
        message: action.message,
      };
    case "finish":
      return {
        ...state,
        activeAttempt: null,
      };
  }
}
