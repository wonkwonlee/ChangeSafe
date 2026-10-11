import { describe, expect, it } from "vitest";
import { kubernetesObjectSha256, GRANT_ANNOTATION } from "@changesafe/kubernetes-enforcer";

/**
 * M4 experiment 01 — can a read of stored state be attributed to the
 * request that was admitted? (docs/M4_EXPERIMENT_01.md)
 *
 * The contract below is deliberately test-local. docs/M4_DECISION.md says
 * not to adopt an observation schema before the experiment shows which
 * bindings actually distinguish "this admission persisted" from "the state
 * happens to be equal". This file is that experiment: every case is built
 * with the production object hash, never a re-implementation of it.
 */

/** What the enforcer knew at the moment it answered ALLOW (E1). */
interface AdmissionEvidence {
  /** `AdmissionReview.request.uid` — identifies the request, not the write. */
  admissionUid: string;
  grantId: string;
  operation: "CREATE" | "UPDATE";
  /** `oldObject.metadata.uid` on UPDATE. Unknowable at grant issuance for CREATE. */
  incarnationUid?: string;
  /** Hash of the admitted object — the grant's `objectSha256`. */
  targetObjectSha256: string;
}

/** A later read-only observation of the same resource. */
type Observation =
  | { kind: "unavailable" }
  | { kind: "absent" }
  | { kind: "present"; raw: KubernetesObject };

interface KubernetesObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
    annotations?: Record<string, string>;
  };
  spec: Record<string, unknown>;
}

/**
 * Every verdict names what the evidence can and cannot separate. There is
 * intentionally no `persisted` member: nothing an offline read yields
 * attests that *this* admission produced the stored state.
 */
type Attribution =
  | "unknown_unobserved"
  | "unknown_absent"
  | "unknown_incarnation"
  | "not_this_incarnation"
  | "unknown_divergent"
  | "state_consistent_unattributed"
  | "state_consistent_grant_marked";

/** Hypothesis H1: hash equality after ALLOW means the admitted write persisted. */
async function naiveHashOnly(evidence: AdmissionEvidence, observation: Observation): Promise<boolean> {
  if (observation.kind !== "present") return false;
  return (await kubernetesObjectSha256(observation.raw)) === evidence.targetObjectSha256;
}

async function attribute(evidence: AdmissionEvidence, observation: Observation): Promise<Attribution> {
  if (observation.kind === "unavailable") return "unknown_unobserved";
  if (observation.kind === "absent") return "unknown_absent";
  const { raw } = observation;
  if (evidence.incarnationUid === undefined) return "unknown_incarnation";
  if (raw.metadata.uid !== evidence.incarnationUid) return "not_this_incarnation";
  if ((await kubernetesObjectSha256(raw)) !== evidence.targetObjectSha256) return "unknown_divergent";
  // The grant annotation is excluded from the hash, so its presence is
  // evidence the hash cannot carry — but it is a client-writable string,
  // so it marks, it does not attribute (see the copied-annotation case).
  const marked = raw.metadata.annotations?.[GRANT_ANNOTATION];
  return marked !== undefined && marked.includes(evidence.grantId)
    ? "state_consistent_grant_marked"
    : "state_consistent_unattributed";
}

const INCARNATION_A = "aaaaaaaa-0000-0000-0000-000000000001";
const INCARNATION_B = "bbbbbbbb-0000-0000-0000-000000000002";
const GRANT_ID = "grant-m4-exp01-0001";
/** Stands in for the signed grant envelope the real enforcer reads. */
const GRANT_CARRIER = JSON.stringify({ grant: { grantId: GRANT_ID } });

function deployment(overrides: {
  uid?: string;
  resourceVersion?: string;
  replicas: number;
  annotations?: Record<string, string>;
}): KubernetesObject {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "web",
      namespace: "default",
      ...(overrides.uid === undefined ? {} : { uid: overrides.uid }),
      ...(overrides.resourceVersion === undefined ? {} : { resourceVersion: overrides.resourceVersion }),
      ...(overrides.annotations === undefined ? {} : { annotations: overrides.annotations }),
    },
    spec: { replicas: overrides.replicas },
  };
}

const PRIOR = deployment({ uid: INCARNATION_A, resourceVersion: "100", replicas: 3 });
const ADMITTED = deployment({
  uid: INCARNATION_A,
  resourceVersion: "100",
  replicas: 4,
  annotations: { [GRANT_ANNOTATION]: GRANT_CARRIER },
});

async function updateEvidence(): Promise<AdmissionEvidence> {
  return {
    admissionUid: "admission-req-0001",
    grantId: GRANT_ID,
    operation: "UPDATE",
    incarnationUid: INCARNATION_A,
    targetObjectSha256: await kubernetesObjectSha256(ADMITTED),
  };
}

describe("M4-01: the production hash cannot see what the gap is made of", () => {
  it("hashes two incarnations with equal state identically (uid is server-owned)", async () => {
    const a = deployment({ uid: INCARNATION_A, replicas: 4 });
    const b = deployment({ uid: INCARNATION_B, replicas: 4 });
    expect(await kubernetesObjectSha256(a)).toBe(await kubernetesObjectSha256(b));
  });

  it("hashes identically across resourceVersion, so it carries no ordering", async () => {
    const early = deployment({ uid: INCARNATION_A, resourceVersion: "100", replicas: 4 });
    const late = deployment({ uid: INCARNATION_A, resourceVersion: "9001", replicas: 4 });
    expect(await kubernetesObjectSha256(early)).toBe(await kubernetesObjectSha256(late));
  });

  it("hashes identically with and without the grant annotation (excluded by design)", async () => {
    const bare = deployment({ uid: INCARNATION_A, replicas: 4 });
    expect(await kubernetesObjectSha256(ADMITTED)).toBe(await kubernetesObjectSha256(bare));
  });
});

describe("M4-01: counterexamples to hash-only correlation (H1)", () => {
  it("recreated incarnation: H1 says persisted; the admitted object no longer exists", async () => {
    const evidence = await updateEvidence();
    // Someone deleted `web` and recreated it at replicas 4 — same name,
    // same spec, new server-assigned uid. The grant-bearing write may or
    // may not have persisted before the delete; the read cannot say.
    const recreated: Observation = {
      kind: "present",
      raw: deployment({ uid: INCARNATION_B, resourceVersion: "250", replicas: 4 }),
    };
    expect(await naiveHashOnly(evidence, recreated)).toBe(true);
    expect(await attribute(evidence, recreated)).toBe("not_this_incarnation");
  });

  it("convergent re-apply: H1 says persisted; another writer produced the equal state", async () => {
    const evidence = await updateEvidence();
    // A reconciler re-applied the desired spec from its own source of
    // truth and owns the annotations, so the grant carrier is gone. State
    // is equal to the admitted target; nothing ties it to this admission.
    const reapplied: Observation = {
      kind: "present",
      raw: deployment({ uid: INCARNATION_A, resourceVersion: "180", replicas: 4 }),
    };
    expect(await naiveHashOnly(evidence, reapplied)).toBe(true);
    expect(await attribute(evidence, reapplied)).toBe("state_consistent_unattributed");
  });

  it("rejected persistence and persisted-then-overwritten are byte-identical reads", async () => {
    const evidence = await updateEvidence();
    // Path C: ALLOW was answered (grant consumed), then the API server
    // rejected the write on a resourceVersion conflict. Path D: the write
    // persisted and a later writer restored replicas 3. Both reads show
    // the prior spec; neither read carries the difference.
    const rejectedDownstream: Observation = { kind: "present", raw: PRIOR };
    const overwrittenAfter: Observation = {
      kind: "present",
      raw: deployment({ uid: INCARNATION_A, resourceVersion: "100", replicas: 3 }),
    };
    expect(overwrittenAfter).toEqual(rejectedDownstream);
    expect(await naiveHashOnly(evidence, rejectedDownstream)).toBe(false);
    expect(await attribute(evidence, rejectedDownstream)).toBe("unknown_divergent");
    expect(await attribute(evidence, overwrittenAfter)).toBe("unknown_divergent");
  });

  it("an unavailable or absent read is unknown, never a failure verdict", async () => {
    const evidence = await updateEvidence();
    expect(await naiveHashOnly(evidence, { kind: "unavailable" })).toBe(false);
    expect(await attribute(evidence, { kind: "unavailable" })).toBe("unknown_unobserved");
    expect(await attribute(evidence, { kind: "absent" })).toBe("unknown_absent");
  });

  it("CREATE evidence cannot bind an incarnation at issuance, so equality stays unknown", async () => {
    const created = deployment({ replicas: 1, annotations: { [GRANT_ANNOTATION]: GRANT_CARRIER } });
    const evidence: AdmissionEvidence = {
      admissionUid: "admission-req-0002",
      grantId: GRANT_ID,
      operation: "CREATE",
      targetObjectSha256: await kubernetesObjectSha256(created),
    };
    const stored: Observation = {
      kind: "present",
      raw: deployment({ uid: INCARNATION_B, resourceVersion: "300", replicas: 1 }),
    };
    expect(await naiveHashOnly(evidence, stored)).toBe(true);
    expect(await attribute(evidence, stored)).toBe("unknown_incarnation");
  });
});

describe("M4-01: the strongest offline verdict is still not attribution", () => {
  it("the grant annotation marks the state but any writer can copy it", async () => {
    const evidence = await updateEvidence();
    const genuine: Observation = {
      kind: "present",
      raw: deployment({
        uid: INCARNATION_A,
        resourceVersion: "101",
        replicas: 4,
        annotations: { [GRANT_ANNOTATION]: GRANT_CARRIER },
      }),
    };
    // A different actor, with ordinary write access, applies the same spec
    // and pastes the annotation it read off the previous object.
    const copied: Observation = {
      kind: "present",
      raw: deployment({
        uid: INCARNATION_A,
        resourceVersion: "177",
        replicas: 4,
        annotations: { [GRANT_ANNOTATION]: GRANT_CARRIER },
      }),
    };
    expect(await attribute(evidence, genuine)).toBe("state_consistent_grant_marked");
    expect(await attribute(evidence, copied)).toBe("state_consistent_grant_marked");
  });

  it("no verdict in the contract reads as a persistence attestation", () => {
    const verdicts: Attribution[] = [
      "unknown_unobserved",
      "unknown_absent",
      "unknown_incarnation",
      "not_this_incarnation",
      "unknown_divergent",
      "state_consistent_unattributed",
      "state_consistent_grant_marked",
    ];
    for (const verdict of verdicts) {
      expect(verdict).not.toMatch(/persist|applied|realized|verified|success/);
    }
  });
});
