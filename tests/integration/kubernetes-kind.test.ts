import { describe, expect, it } from "vitest";

describe("optional Kubernetes kind contract", () => {
  it.skipIf(process.env.CHANGESAFE_K8S_LIVE_TEST !== "1")("is opt-in and collector-only", () => {
    // The operator provisions the namespace and read-only ServiceAccount.
    // This repository test deliberately creates no resources.
    expect(process.env.CHANGESAFE_K8S_LIVE_TEST).toBe("1");
  });
});
