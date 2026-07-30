import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { hashCanonical, type JsonValue } from "@changesafe/core";

import { SelfHostedReviewDetail } from "@/components/SelfHostedReviewDetail";
import {
  createSelfHostedReviewTransport,
  type SelfHostedReviewEntry,
  type SelfHostedReviewProjection,
} from "@/features/reviews/selfHostedReviewTransport";

const review: SelfHostedReviewEntry = {
  seq: 1,
  reviewId: "review-network-one",
  createdAtUtc: "2026-07-30T12:00:00.000Z",
  domainId: "network",
  sourceId: "network-source",
  inputId: "network-input",
  record: {
    recordVersion: "2",
    reviewId: "review-network-one",
    createdAtUtc: "2026-07-30T12:00:00.000Z",
    owner: {
      tenantId: "https://idp.example.test",
      issuer: "https://idp.example.test",
      subject: "alice",
      scope: "self-hosted-review",
    },
    session: {
      domainId: "network",
      contractVersion: "2.0.0",
      policyVersion: "core-v1+network-v1",
      domainShape: "simulated-state",
      capabilities: {
        sandboxSimulation: true,
        resourceGraph: true,
        structuredDiff: true,
        untrustedContext: true,
        durableDecision: true,
      },
      runtimeMode: "self-hosted",
      source: "uploaded-offline-artifact",
      analysisMode: "offline",
      provenance: "uploaded-offline-artifact",
    },
    intake: {
      domainId: "network",
      source: {
        domainId: "network",
        sourceId: "network-source",
        sourceKind: "network-incident-bundle",
        origin: "uploaded-offline-artifact",
        untrustedArtifactObservedAtUtc: "2026-07-30T11:59:00.000Z",
      },
      input: {
        inputId: "network-input",
        inputSha256: "a".repeat(64),
        content: {},
      },
    },
    storage: { kind: "append-only-review-store" },
  },
};

const projection: SelfHostedReviewProjection = {
  policyVersion: "core-v1+network-v1",
  findings: [
    {
      policyId: "BLAST_RADIUS",
      status: "WARN",
      title: "Blast radius exceeds the warn threshold",
      explanation: "Three devices are touched by this change.",
      affectedResources: ["device:edge-rtr-01"],
      remediation: "Split the change into smaller steps.",
    },
  ],
  riskLevel: "MEDIUM",
  approvable: true,
};

function render(
  overrides: Partial<Parameters<typeof SelfHostedReviewDetail>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(SelfHostedReviewDetail, {
      review,
      projection,
      proof: { status: "not-created" },
      resolutionStatus: "pending",
      busy: false,
      actionMessage: null,
      onDecide: () => undefined,
      ...overrides,
    }),
  );
}

describe("self-hosted review detail", () => {
  it("shows the server-recomputed findings and risk to the deciding human", () => {
    const markup = render();

    expect(markup).toContain("Server-recomputed policy findings");
    expect(markup).toContain("BLAST_RADIUS");
    expect(markup).toContain("WARN");
    expect(markup).toContain("Blast radius exceeds the warn threshold");
    expect(markup).toContain("Three devices are touched by this change.");
    expect(markup).toContain("MEDIUM");
    expect(markup).toContain("core-v1+network-v1");
    // Evidence must precede the controls it exists to inform.
    expect(markup.indexOf("Server-recomputed policy findings")).toBeLessThan(
      markup.indexOf("Authenticated human decision"),
    );
  });

  it("says plainly that no recomputation was read rather than implying a clean gate", () => {
    const markup = render({ projection: null });

    expect(markup).toContain("No server recomputation has been read");
    expect(markup).not.toContain("BLAST_RADIUS");
    expect(markup).not.toContain(">Approve<");
    expect(markup).not.toContain(">Reject<");
  });

  it("reports an unapprovable blocked change without inventing a verdict", () => {
    const markup = render({
      projection: {
        ...projection,
        riskLevel: "CRITICAL",
        approvable: false,
        findings: [
          { ...projection.findings[0]!, status: "BLOCK", policyId: "MGMT_REACHABILITY" },
        ],
      },
    });

    expect(markup).toContain("MGMT_REACHABILITY");
    expect(markup).toContain("BLOCK");
    expect(markup).toContain("refuses approval for anyone");
  });
});

describe("self-hosted review detail transport contract", () => {
  // The transport revalidates the intake against its real domain schema, so
  // this fixture uses a shipped scenario rather than a placeholder body.
  const networkInput = JSON.parse(
    readFileSync("scenarios/network/scenario-a-failover/incident.json", "utf8"),
  ) as JsonValue;
  const networkProposal = (
    JSON.parse(
      readFileSync(
        "scenarios/network/scenario-a-failover/replay-fixture.json",
        "utf8",
      ),
    ) as { proposal: JsonValue & { proposalId: string } }
  ).proposal;

  let detailBody: { review: SelfHostedReviewEntry; projection: SelfHostedReviewProjection };

  beforeAll(async () => {
    detailBody = {
      review: {
        ...review,
        inputId: "inc-uplink-degraded-4821",
        record: {
          ...review.record,
          intake: {
            ...review.record.intake,
            input: {
              inputId: "inc-uplink-degraded-4821",
              inputSha256: await hashCanonical(networkInput),
              content: networkInput,
            },
            proposal: {
              proposalId: networkProposal.proposalId,
              proposalSha256: await hashCanonical(networkProposal),
              content: networkProposal,
            },
          },
        },
      },
      projection,
    };
  });

  it("reads findings only from the response-time projection", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(detailBody));
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test",
      fetchImpl,
    );

    await expect(transport.get("review-network-one")).resolves.toEqual(detailBody);
  });

  it("refuses a stored record that carries its own findings or risk", async () => {
    const forged = {
      review: {
        ...detailBody.review,
        record: { ...detailBody.review.record, findings: [], riskLevel: "LOW" },
      },
      projection,
    };
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(forged)),
    );

    await expect(transport.get("review-network-one")).rejects.toThrow();
  });

  it("refuses a detail response with no server projection at all", async () => {
    const transport = createSelfHostedReviewTransport(
      "https://review.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ review: detailBody.review })),
    );

    await expect(transport.get("review-network-one")).rejects.toThrow();
  });
});
