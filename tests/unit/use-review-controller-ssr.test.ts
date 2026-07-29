import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { ReviewSessionEnvelope } from "@/features/domains/review-contract";
import {
  useReviewController,
  type ReviewTransport,
} from "@/features/reviews/useReviewController";

it("initializes during server rendering without generating attempts or invoking transport", () => {
  const transport =
    vi.fn<ReviewTransport<{ incidentId: string }>>();
  const attemptIdFactory = vi.fn(() => "attempt-one");
  const session: ReviewSessionEnvelope = {
    domainId: "network",
    contractVersion: "1.0.0",
    domainShape: "simulated-state",
    capabilities: {
      sandboxSimulation: true,
      resourceGraph: true,
      structuredDiff: true,
      untrustedContext: true,
      durableDecision: false,
    },
    runtimeMode: "public-replay",
    source: "bundled-replay",
    analysisMode: "replay",
    provenance: "captured-replay",
  };

  function Probe() {
    const controller = useReviewController({
      sourceId: "scenario-one",
      input: { incidentId: "incident-one" },
      expectedInputId: "incident-one",
      session,
      transport,
      attemptIdFactory,
    });
    return createElement("span", null, controller.state.workflow.phase);
  }

  expect(renderToString(createElement(Probe))).toContain("READY");
  expect(attemptIdFactory).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
