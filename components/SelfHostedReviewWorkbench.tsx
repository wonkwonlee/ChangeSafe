"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { SelfHostedReviewDetail } from "./SelfHostedReviewDetail";
import { SelfHostedReviewQueue } from "./SelfHostedReviewQueue";
import { WorkbenchNav } from "./WorkbenchNav";
import {
  SELF_HOSTED_REVIEW_EXAMPLES,
  createSelfHostedIntake,
} from "@/features/reviews/selfHostedReviewExamples";
import {
  SelfHostedReviewTransportError,
  createSelfHostedReviewTransport,
  type SelfHostedReviewSummary,
} from "@/features/reviews/selfHostedReviewTransport";
import {
  INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
  selfHostedReviewViewReducer,
  type ReceiptProofViewState,
  type ReviewAttempt,
  type ReviewResolutionStatus,
} from "@/features/reviews/selfHostedReviewViewState";

const INITIAL_EXAMPLE = SELF_HOSTED_REVIEW_EXAMPLES[0] ?? (() => {
  throw new Error("A self-hosted review example is required.");
})();

function errorMessage(error: unknown): string {
  if (error instanceof SelfHostedReviewTransportError) return error.message;
  return "The self-hosted review request failed safely. No authority was assumed.";
}

export function SelfHostedReviewWorkbench({
  publicGatewayUrl,
}: {
  publicGatewayUrl: string | null;
}) {
  const connection = useMemo(() => {
    if (!publicGatewayUrl) {
      return { transport: null, configurationError: null };
    }
    try {
      return {
        transport: createSelfHostedReviewTransport(publicGatewayUrl),
        configurationError: null,
      };
    } catch {
      return {
        transport: null,
        configurationError:
          "Self-hosted review configuration is invalid. No connection was attempted.",
      };
    }
  }, [publicGatewayUrl]);
  const { transport } = connection;
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
  const [reviews, setReviews] = useState<readonly SelfHostedReviewSummary[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [viewState, dispatch] = useReducer(
    selfHostedReviewViewReducer,
    INITIAL_SELF_HOSTED_REVIEW_VIEW_STATE,
  );
  const attemptToken = useRef(0);
  const queueAttemptToken = useRef(0);
  const example = SELF_HOSTED_REVIEW_EXAMPLES.find(
    ({ sourceId }) => sourceId === selectedSourceId,
  ) ?? INITIAL_EXAMPLE;
  const busy = queueBusy || viewState.activeAttempt !== null;

  function beginAttempt(
    kind: ReviewAttempt["kind"],
    reviewId: string,
  ): ReviewAttempt {
    const attempt = {
      token: ++attemptToken.current,
      reviewId,
      kind,
    } satisfies ReviewAttempt;
    dispatch({ type: "begin", attempt });
    return attempt;
  }

  const refreshQueue = useCallback(async () => {
    if (!transport) return;
    const token = ++queueAttemptToken.current;
    setQueueBusy(true);
    setQueueMessage(null);
    try {
      const nextReviews = await transport.list();
      if (queueAttemptToken.current === token) {
        setReviews(nextReviews);
      }
    } catch (error) {
      if (queueAttemptToken.current === token) {
        setQueueMessage(errorMessage(error));
      }
    } finally {
      if (queueAttemptToken.current === token) {
        setQueueBusy(false);
      }
    }
  }, [transport]);

  async function selectReview(reviewId: string) {
    if (!transport) return;
    setQueueMessage(null);
    const attempt = beginAttempt("select", reviewId);
    try {
      const [reviewResult, proofResult] = await Promise.allSettled([
        transport.get(reviewId),
        transport.getReceiptProof(reviewId),
      ]);
      if (reviewResult.status === "rejected") {
        dispatch({
          type: "failed",
          attempt,
          message: errorMessage(reviewResult.reason),
        });
        return;
      }

      let resolutionStatus: ReviewResolutionStatus;
      let proof: ReceiptProofViewState;
      let message: string | undefined;
      if (proofResult.status === "rejected") {
        resolutionStatus = "unknown";
        proof = { status: "unavailable" };
        message = errorMessage(proofResult.reason);
      } else if (proofResult.value.status === "resolved") {
        resolutionStatus = "resolved";
        proof = { status: "available", proof: proofResult.value.proof };
      } else {
        resolutionStatus = "pending";
        proof = { status: "not-created" };
      }
      dispatch({
        type: "selected",
        attempt,
        review: reviewResult.value.review,
        projection: reviewResult.value.projection,
        resolutionStatus,
        proof,
        message,
      });
    } finally {
      dispatch({ type: "finish", attempt });
    }
  }

  useEffect(() => {
    if (!transport) return;
    let active = true;
    const token = ++queueAttemptToken.current;
    transport.list().then(
      (nextReviews) => {
        if (active && queueAttemptToken.current === token) {
          setReviews(nextReviews);
        }
      },
      (error: unknown) => {
        if (active && queueAttemptToken.current === token) {
          setQueueMessage(errorMessage(error));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [transport]);

  async function createReview() {
    if (!transport || example.domainId === "kubernetes") return;
    const reviewId = `review-${crypto.randomUUID()}`;
    setQueueMessage(null);
    const attempt = beginAttempt("create", reviewId);
    let created = false;
    try {
      const review = await transport.create(
        reviewId,
        await createSelfHostedIntake(example, new Date().toISOString()),
      );
      created = true;
      dispatch({ type: "created", attempt, review });
    } catch (error) {
      dispatch({ type: "failed", attempt, message: errorMessage(error) });
    }

    // The queue refresh is a separate request. Folding its failure into the
    // create catch above would tell the operator the review was not created
    // when in fact it was.
    if (created) {
      const queueToken = ++queueAttemptToken.current;
      try {
        const nextReviews = await transport.list();
        if (
          attemptToken.current === attempt.token &&
          queueAttemptToken.current === queueToken
        ) {
          setReviews(nextReviews);
        }
      } catch (error) {
        if (queueAttemptToken.current === queueToken) {
          dispatch({
            type: "failed",
            attempt,
            message: `The review was created. Refreshing the queue failed: ${errorMessage(error)}`,
          });
        }
      }
    }
    dispatch({ type: "finish", attempt });
  }

  async function decide(decision: "approve" | "reject") {
    if (
      !transport ||
      !viewState.review ||
      viewState.resolutionStatus !== "pending" ||
      !viewState.projection
    ) {
      return;
    }
    const reviewId = viewState.review.reviewId;
    setQueueMessage(null);
    const attempt = beginAttempt("decide", reviewId);
    try {
      await transport.decide(reviewId, decision);
      dispatch({ type: "decision-resolved", attempt });
      try {
        const proofResult = await transport.getReceiptProof(reviewId);
        if (proofResult.status === "resolved") {
          dispatch({
            type: "proof-completed",
            attempt,
            proof: { status: "available", proof: proofResult.proof },
          });
        } else {
          dispatch({
            type: "proof-completed",
            attempt,
            proof: { status: "unavailable" },
            message:
              "The decision was resolved, but receipt proof is not available yet.",
          });
        }
      } catch (error) {
        dispatch({
          type: "proof-completed",
          attempt,
          proof: { status: "unavailable" },
          message: errorMessage(error),
        });
      }
    } catch (error) {
      dispatch({ type: "failed", attempt, message: errorMessage(error) });
    } finally {
      dispatch({ type: "finish", attempt });
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-edge bg-surface">
        <WorkbenchNav active="self-hosted" />
      </header>

      <section className="border-b border-edge bg-overlay">
        <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
          <p className="eyebrow text-active">Authenticated self-hosted</p>
          <h1 className="mt-2 text-2xl font-semibold">Durable review queue</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
            Intake immutable offline artifacts, submit a human decision, and inspect independent receipt proof claims. Authentication is supplied by the self-hosted deployment; this client stores no token and never executes infrastructure.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-faint">
            The gateway URL is public, browser-visible configuration. It must use HTTPS outside explicit loopback development and must never contain credentials; authentication remains in an HttpOnly session cookie.
          </p>
          {!publicGatewayUrl || connection.configurationError ? (
            <p className="mt-4 rounded border border-warn/50 bg-warn/10 p-3 text-sm text-warn" role="status">
              {connection.configurationError ??
                "Self-hosted review is not configured. Set CHANGESAFE_PUBLIC_SELF_HOSTED_GATEWAY_URL to the browser-visible HTTPS gateway URL. This public setting must contain no credential; the gateway supplies authentication through an HttpOnly session cookie."}
            </p>
          ) : null}
        </div>
      </section>

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)_minmax(260px,0.8fr)]">
        <aside className="rounded-xl border border-edge bg-surface p-4" aria-label="Offline artifact intake">
          <p className="eyebrow text-ink-faint">Offline artifact intake</p>
          <label className="mt-4 block text-sm font-medium" htmlFor="self-hosted-example">Example artifact</label>
          <select className="mt-2 w-full rounded border border-edge bg-canvas px-3 py-2 text-sm" disabled={busy} id="self-hosted-example" onChange={(event) => setSelectedSourceId(event.target.value)} value={selectedSourceId}>
            {SELF_HOSTED_REVIEW_EXAMPLES.map((candidate) => <option key={candidate.sourceId} value={candidate.sourceId}>{candidate.domainId} · {candidate.label}</option>)}
          </select>
          <p className="mt-2 text-xs text-ink-faint">
            Durable intake: Network and Terraform supported · Kubernetes unsupported
          </p>
          <p className="mt-3 text-sm text-ink-dim">{example.description}</p>
          {example.domainId === "kubernetes" ? (
            <p className="mt-3 rounded border border-warn/50 bg-warn/10 p-3 text-sm text-warn" role="status">Unsupported for durable self-hosted review. Use the Kubernetes public offline workbench; no cluster access or apply exists.</p>
          ) : null}
          <button className="mt-4 w-full rounded bg-active px-4 py-2 text-sm font-semibold text-action-primary-foreground disabled:opacity-50" disabled={busy || !transport || example.domainId === "kubernetes"} onClick={() => void createReview()} type="button">Add to authenticated queue</button>
        </aside>

        <main aria-label="Authenticated review detail">
          <SelfHostedReviewDetail
            actionMessage={viewState.message ?? queueMessage}
            busy={busy}
            onDecide={(decision) => void decide(decision)}
            projection={viewState.projection}
            proof={viewState.proof}
            resolutionStatus={viewState.resolutionStatus}
            review={viewState.review}
          />
        </main>

        <aside className="rounded-xl border border-edge bg-surface p-4" aria-busy={busy} aria-label="Authenticated review queue">
          <div className="flex items-center justify-between gap-3">
            <div><p className="eyebrow text-ink-faint">Owner-scoped queue</p><h2 className="mt-2 text-base font-semibold">Reviews</h2></div>
            <button className="rounded border border-edge px-3 py-2 text-xs disabled:opacity-50" disabled={busy || !transport} onClick={() => void refreshQueue()} type="button">Refresh</button>
          </div>
          <SelfHostedReviewQueue
            disabled={busy}
            onSelect={(reviewId) => void selectReview(reviewId)}
            reviews={reviews}
            selectedReviewId={viewState.targetReviewId}
          />
        </aside>
      </div>
    </div>
  );
}
