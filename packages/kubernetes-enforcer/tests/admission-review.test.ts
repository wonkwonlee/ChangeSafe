import { describe, expect, it } from "vitest";
import {
  AdmissionReviewRequestSchema,
  buildAdmissionReviewResponse,
} from "../src/admission-review";

function buildReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    apiVersion: "admission.k8s.io/v1",
    kind: "AdmissionReview",
    request: {
      uid: "11111111-1111-1111-1111-111111111111",
      operation: "UPDATE",
      userInfo: { username: "system:serviceaccount:ops:changesafe-applier", uid: "u-1", groups: [] },
      object: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "web", namespace: "default" },
        spec: { replicas: 3 },
      },
      ...overrides,
    },
  };
}

describe("AdmissionReviewRequestSchema", () => {
  it("accepts a well-formed admission review", () => {
    expect(AdmissionReviewRequestSchema.safeParse(buildReview()).success).toBe(true);
  });

  it("rejects a missing userInfo", () => {
    const review = buildReview();
    delete (review.request as Record<string, unknown>).userInfo;
    expect(AdmissionReviewRequestSchema.safeParse(review).success).toBe(false);
  });

  it("rejects an unknown operation", () => {
    expect(
      AdmissionReviewRequestSchema.safeParse(buildReview({ operation: "PATCH" })).success,
    ).toBe(false);
  });
});

describe("buildAdmissionReviewResponse", () => {
  it("echoes the request uid and carries the verdict", () => {
    const allowed = buildAdmissionReviewResponse("11111111-1111-1111-1111-111111111111", {
      allowed: true,
    });
    expect(allowed).toEqual({
      apiVersion: "admission.k8s.io/v1",
      kind: "AdmissionReview",
      response: { uid: "11111111-1111-1111-1111-111111111111", allowed: true },
    });

    const denied = buildAdmissionReviewResponse("11111111-1111-1111-1111-111111111111", {
      allowed: false,
      message: "grant object hash mismatch",
    });
    expect(denied.response).toEqual({
      uid: "11111111-1111-1111-1111-111111111111",
      allowed: false,
      status: { message: "grant object hash mismatch" },
    });
  });
});
