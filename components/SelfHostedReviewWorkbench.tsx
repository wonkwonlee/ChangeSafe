"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { SelfHostedReviewDetail } from "./SelfHostedReviewDetail";
import { SelfHostedReviewQueue } from "./SelfHostedReviewQueue";
import {
  SELF_HOSTED_REVIEW_EXAMPLES,
  createSelfHostedIntake,
} from "@/features/reviews/selfHostedReviewExamples";
import {
  SelfHostedReviewTransportError,
  createSelfHostedReviewTransport,
  type SelfHostedReviewEntry,
  type SelfHostedReviewSummary,
} from "@/features/reviews/selfHostedReviewTransport";
import type { ReceiptProof } from "@/features/reviews/durable-review-contract";

const INITIAL_EXAMPLE = SELF_HOSTED_REVIEW_EXAMPLES[0] ?? (() => {
  throw new Error("A self-hosted review example is required.");
})();

function errorMessage(error: unknown): string {
  if (error instanceof SelfHostedReviewTransportError) return error.message;
  return "The self-hosted review request failed safely. No authority was assumed.";
}

export function SelfHostedReviewWorkbench({ baseUrl }: { baseUrl: string | null }) {
  const connection = useMemo(() => {
    if (!baseUrl) return { transport: null, configurationError: null };
    try {
      return {
        transport: createSelfHostedReviewTransport(baseUrl),
        configurationError: null,
      };
    } catch {
      return {
        transport: null,
        configurationError:
          "Self-hosted review configuration is invalid. No connection was attempted.",
      };
    }
  }, [baseUrl]);
  const { transport } = connection;
  const [selectedSourceId, setSelectedSourceId] = useState(INITIAL_EXAMPLE.sourceId);
  const [reviews, setReviews] = useState<readonly SelfHostedReviewSummary[]>([]);
  const [selectedReview, setSelectedReview] = useState<SelfHostedReviewEntry | null>(null);
  const [proof, setProof] = useState<ReceiptProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const example = SELF_HOSTED_REVIEW_EXAMPLES.find(
    ({ sourceId }) => sourceId === selectedSourceId,
  ) ?? INITIAL_EXAMPLE;

  const refreshQueue = useCallback(async () => {
    if (!transport) return;
    setBusy(true);
    setMessage(null);
    try {
      setReviews(await transport.list());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [transport]);

  const selectReview = useCallback(async (reviewId: string) => {
    if (!transport) return;
    setBusy(true);
    setMessage(null);
    try {
      const [review, proofResult] = await Promise.all([
        transport.get(reviewId),
        transport.getReceiptProof(reviewId),
      ]);
      setSelectedReview(review);
      setProof(proofResult.status === "resolved" ? proofResult.proof : null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [transport]);

  useEffect(() => {
    if (!transport) return;
    let active = true;
    transport.list().then(
      (nextReviews) => {
        if (active) setReviews(nextReviews);
      },
      (error: unknown) => {
        if (active) setMessage(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [transport]);

  async function createReview() {
    if (!transport || example.domainId === "kubernetes") return;
    setBusy(true);
    setMessage(null);
    try {
      const review = await transport.create(
        `review-${crypto.randomUUID()}`,
        await createSelfHostedIntake(example, new Date().toISOString()),
      );
      setSelectedReview(review);
      setProof(null);
      setReviews(await transport.list());
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!transport || !selectedReview) return;
    setBusy(true);
    setMessage(null);
    try {
      await transport.decide(selectedReview.reviewId, decision);
      const proofResult = await transport.getReceiptProof(selectedReview.reviewId);
      setProof(proofResult.status === "resolved" ? proofResult.proof : null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-edge bg-surface">
        <nav aria-label="Runtime navigation" className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          <Link className="mr-auto font-bold" href="/">ChangeSafe</Link>
          <Link className="rounded px-3 py-2 text-sm text-ink-dim hover:text-ink" href="/">Legacy local</Link>
          <Link className="rounded px-3 py-2 text-sm text-ink-dim hover:text-ink" href="/workbench">Public replay</Link>
          <span aria-current="page" className="rounded border border-active/50 bg-active/10 px-3 py-2 text-sm text-active">Authenticated self-hosted</span>
        </nav>
      </header>

      <section className="border-b border-edge bg-overlay">
        <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
          <p className="eyebrow text-active">Authenticated self-hosted</p>
          <h1 className="mt-2 text-2xl font-semibold">Durable review queue</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
            Intake immutable offline artifacts, submit a human decision, and inspect independent receipt proof claims. Authentication is supplied by the self-hosted deployment; this client stores no token and never executes infrastructure.
          </p>
          {!baseUrl || connection.configurationError ? (
            <p className="mt-4 rounded border border-warn/50 bg-warn/10 p-3 text-sm text-warn" role="status">
              {connection.configurationError ??
                "Self-hosted review is not configured. Set the server-only CHANGESAFE_SELF_HOSTED_BASE_URL to the authenticated gateway HTTP(S) base URL; no credential belongs in this setting."}
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
          <button className="mt-4 w-full rounded bg-active px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !transport || example.domainId === "kubernetes"} onClick={() => void createReview()} type="button">Add to authenticated queue</button>
        </aside>

        <main aria-label="Authenticated review detail">
          <SelfHostedReviewDetail actionMessage={message} busy={busy} onDecide={(decision) => void decide(decision)} proof={proof} review={selectedReview} />
        </main>

        <aside className="rounded-xl border border-edge bg-surface p-4" aria-busy={busy} aria-label="Authenticated review queue">
          <div className="flex items-center justify-between gap-3">
            <div><p className="eyebrow text-ink-faint">Owner-scoped queue</p><h2 className="mt-2 text-base font-semibold">Reviews</h2></div>
            <button className="rounded border border-edge px-3 py-2 text-xs disabled:opacity-50" disabled={busy || !transport} onClick={() => void refreshQueue()} type="button">Refresh</button>
          </div>
          <SelfHostedReviewQueue onSelect={(reviewId) => void selectReview(reviewId)} reviews={reviews} selectedReviewId={selectedReview?.reviewId ?? null} />
        </aside>
      </div>
    </div>
  );
}
